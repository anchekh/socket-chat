import { PrismaClient } from "./generated/prisma";

interface WebSocketData {
    username: string | null;
    rooms: string[];
}

interface LoginData {
    user: string;
    roomName?: string;
}

interface CreateRoomData {
    roomName: string;
    type: "private" | "public";
    members?: string[];
    inviter?: string;
}

interface JoinRoomData {
    user: string;
    room: string;
}

interface LeaveRoomData {
    user: string;
    room?: string;
}

interface TypingData {
    user: string;
    room: string;
}

interface MessageData {
    user: string;
    room: string;
    text: string;
}

interface LikeMessageData {
    user: string;
    messageId?: string;
}

export class BunSocketServer {
    private prisma = new PrismaClient();
    private server!: Bun.Server<WebSocketData>;
    private readonly PORT = Number(Bun.env.PORT || 3000);

    // Таймеры
    private typingTimers = new Map<string, Timer>();
    private awayTimers = new Map<string, Timer>();
    private lastMessageMap = new Map<string, { text: string; ts: number }>();

    constructor() {
        this.configureServer();
        this.start();
    }

    private configureServer() {
        this.server = Bun.serve<WebSocketData>({ 
            port: this.PORT,
            
            fetch: (req, server) => {
                const url = new URL(req.url);
                
                if (url.pathname === "/") {
                    return new Response("Hello World!");
                }

                if (url.pathname === "/ws") {
                    const success = server.upgrade(req, {
                        data: {
                            username: null,
                            rooms: []
                        }
                    });
                    
                    return success ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
                }

                return new Response("Not found", { status: 404 });
            },

            websocket: {
                idleTimeout: 300,
                maxPayloadLength: 64 * 1024,
                perMessageDeflate: true,
                
                open: (ws) => {
                    console.log("socket: connected", ws.remoteAddress);
                },

                message: async (ws, message) => {
                    try {
                        const data = JSON.parse(message.toString());
                        await this.handleSocketEvent(ws, data);
                    } catch (error) {
                        console.error("Message parsing error:", error);
                        this.sendError(ws, "Invalid message format");
                    }
                },

                close: (ws, code, reason) => {
                    console.log("socket: disconnected", ws.remoteAddress, code, reason);
                    this.handleDisconnect(ws);
                }
            }
        });
    }

    private async handleSocketEvent(ws: any, data: any) {
        const eventType = data.type;
        const eventData = data.data;

        switch (eventType) {
            case "login":
                await this.loginUser(ws, eventData);
                break;
            case "createRoom":
                await this.createRoom(ws, eventData);
                break;
            case "joinRoom":
                await this.joinRoom(ws, eventData);
                break;
            case "leaveRoom":
                await this.leaveRoom(ws, eventData);
                break;
            case "typing":
                await this.typing(ws, eventData);
                break;
            case "message":
                await this.message(ws, eventData);
                break;
            case "likeMessage":
                await this.likeMessage(ws, eventData);
                break;
            case "logout":
                await this.logout(ws, eventData);
                break;
            default:
                this.sendError(ws, "Unknown event type");
        }
    }

    // Поиск @
    private extractionMentions(text: string) {
        const pattern = /@([a-zA-Z0-9_]+)/g;
        const names = new Set<string>();
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(text)) !== null) {
            if (match[1]) names.add(match[1]);
        }
        return Array.from(names);
    }

    // Сброс "отошел"
    private async resetAway(username: string) {
        if (!username) return;

        const previousTimer = this.awayTimers.get(username);
        if (previousTimer) clearTimeout(previousTimer);

        const timer = setTimeout(async () => {
            await this.prisma.user.updateMany({
                where: { username },
                data: { status: "away" }
            });
            this.broadcastToAll("userStatusChanged", { username, status: "away" });
            this.awayTimers.delete(username);
        }, 60000);

        this.awayTimers.set(username, timer);
    }

    // Авторизация пользователя
    private async loginUser(ws: any, data: LoginData) {
        try {
            const username = data.user;
            ws.data.username = username;
            ws.subscribe(`user:${username}`);

            // Создание или обновление пользователя
            const user = await this.prisma.user.upsert({
                where: { username },
                update: { status: "online", nowRoom: data.roomName ?? null },
                create: { username, status: "online", nowRoom: data.roomName ?? null }
            });

            // Присоединение к комнате если указана
            if (data.roomName) {
                const room = await this.prisma.room.findUnique({ where: { name: data.roomName } });

                // Приватная комната
                if (room?.isPrivate) {
                    const allowedUsers = (room.allowedUsers ?? "").split(",").map(user => user.trim());
                    const invite = await this.prisma.roomInvite.findFirst({
                        where: { roomId: room.id, invitee: username }
                    });

                    if (!allowedUsers.includes(username) && !invite) {
                        this.sendError(ws, "У вас нет доступа в приватную комнату");
                        return;
                    } else {
                        ws.subscribe(data.roomName);
                        ws.data.rooms.push(data.roomName);
                    }
                } else {
                    // Публичная комната
                    if (!room) {
                        const newRoom = await this.prisma.room.create({
                            data: { name: data.roomName, isPrivate: false }
                        });
                        this.broadcastToAll("roomCreated", { name: newRoom.name, isPrivate: newRoom.isPrivate });
                    }
                    ws.subscribe(data.roomName);
                    ws.data.rooms.push(data.roomName);
                }
            }

            // Получение офлайн-сообщений
            const dbUser = await this.prisma.user.findUnique({ where: { username } });

            if (dbUser) {
                const unreadMessages = await this.prisma.unreadMessage.findMany({
                    where: { userId: dbUser.id },
                    include: { message: { include: { user: true, room: true } } }
                });

                if (unreadMessages.length) {
                    this.sendToSocket(ws, "offlineMessages", unreadMessages.map(unread => ({
                        id: unread.messageId,
                        text: unread.message.text,
                        from: unread.message.user.username,
                        room: unread.message.room.name,
                        createdAt: unread.message.createdAt
                    })));

                    await this.prisma.unreadMessage.deleteMany({ where: { userId: dbUser.id } });
                }
            }

            // Онлайн
            this.broadcastToAll("userStatusChanged", { username, status: "online", nowRoom: data.roomName ?? null });

            // Данные о присоединении
            this.sendToSocket(ws, "joinedRoom", {
                roomName: data.roomName ?? null,
                role: user.role ?? 1,
                isMuted: user.isMuted ?? false
            });

            // Список пользователей в комнате
            if (data.roomName) {
                const users = await this.prisma.user.findMany({ where: { nowRoom: data.roomName } });
                this.sendToSocket(ws, "roomUsers", users.map(user => ({
                    username: user.username,
                    status: user.status,
                    role: user.role,
                    isMuted: user.isMuted
                })));
            }

            await this.resetAway(username);
        } catch (err) {
            console.error(err);
            this.sendError(ws, "Ошибка логина");
        }
    }

    // Создание комнаты
    private async createRoom(ws: any, data: CreateRoomData) {
        const exists = await this.prisma.room.findUnique({ where: { name: data.roomName } });
        if (exists) {
            this.sendError(ws, "Комната уже существует");
            return;
        }

        const room = await this.prisma.room.create({
            data: {
                name: data.roomName,
                isPrivate: data.type === "private",
                allowedUsers: (data.members ?? []).join(",")
            }
        });

        // Приглашения
        if (data.type === "private" && data.members) {
            for (const member of data.members) {
                await this.prisma.roomInvite.create({
                    data: { roomId: room.id, invitee: member, inviter: data.inviter ?? "DefaultUser" }
                });
            }
        }

        this.broadcastToAll("roomCreated", { name: room.name, isPrivate: room.isPrivate });
    }

    // Присоединение к комнате
    private async joinRoom(ws: any, data: JoinRoomData) {
        const room = await this.prisma.room.findUnique({ where: { name: data.room } });
        if (!room) {
            this.sendError(ws, "Такой комнаты не существует");
            return;
        }

        // Доступ к приватной комнате
        if (room.isPrivate) {
            const allowedUsers = (room.allowedUsers ?? "").split(",").map(user => user.trim());
            const invite = await this.prisma.roomInvite.findFirst({
                where: { roomId: room.id, invitee: data.user }
            });

            if (!allowedUsers.includes(data.user) && !invite) {
                this.sendError(ws, "Нет доступа");
                return;
            }
        }

        ws.subscribe(data.room);
        ws.data.rooms.push(data.room);

        await this.prisma.user.updateMany({
            where: { username: data.user },
            data: { nowRoom: data.room, status: "online" }
        });

        // Уведомление о новом участнике
        this.broadcastToRoom(data.room, "roomMessage", { message: `${data.user} присоединился` });
        this.broadcastToAll("userStatusChanged", { username: data.user, status: "online", nowRoom: data.room });
        this.resetAway(data.user);
    }

    // Выход из комнаты
    private async leaveRoom(ws: any, data: LeaveRoomData) {
        const username = data.user;
        const roomName = data.room ?? ws.data.rooms.find((room: string) => !room.startsWith("user:"));
        if (!roomName) return;

        ws.unsubscribe(roomName);
        ws.data.rooms = ws.data.rooms.filter((room: string) => room !== roomName);

        await this.prisma.user.updateMany({ where: { username }, data: { nowRoom: null } });
        this.broadcastToRoom(roomName, "roomMessage", { message: `${username} вышел из комнаты` });
        this.broadcastToAll("userStatusChanged", { username, status: "online", nowRoom: null });
    }

    // Набор
    private async typing(ws: any, data: TypingData) {
        const username = data.user;

        // Сброс таймера
        if (this.typingTimers.has(username)) {
            clearTimeout(this.typingTimers.get(username)!);
            this.typingTimers.delete(username);
        }

        await this.prisma.user.updateMany({ where: { username }, data: { status: "typing" } });
        this.broadcastToAll("userStatusChanged", { username, status: "typing" });

        const timer = setTimeout(async () => {
            await this.prisma.user.updateMany({ where: { username }, data: { status: "online" } });
            this.broadcastToAll("userStatusChanged", { username, status: "online" });
            this.typingTimers.delete(username);
        }, 3000);

        this.typingTimers.set(username, timer);
        this.resetAway(username);
    }

    // Отправка сообщения
    private async message(ws: any, data: MessageData) {
        const username = data.user;
        const text = data.text.trim();
        if (!text) {
            this.sendError(ws, "Пустое сообщение");
            return;
        }

        // Антиспам
        const lastMessage = this.lastMessageMap.get(username);
        const now = Date.now();
        if (lastMessage && lastMessage.text === text && now - lastMessage.ts < 5000) {
            this.sendError(ws, "Нельзя спамить!");
            return;
        }

        this.lastMessageMap.set(username, { text, ts: now });

        const dbUser = await this.prisma.user.findUnique({ where: { username } });
        const dbRoom = await this.prisma.room.findUnique({ where: { name: data.room } });
        if (!dbUser || !dbRoom) return;

        // Мут
        if (dbUser.isMuted) {
            this.sendError(ws, "Вам ничего нельзя");
            return;
        }

        const mentions = this.extractionMentions(text);
        const message = await this.prisma.message.create({
            data: {
                text,
                userId: dbUser.id,
                roomId: dbRoom.id,
                mentions: mentions.join(",")
            },
            include: { user: true, room: true }
        });

        // Отправка сообщения в комнату
        this.broadcastToRoom(data.room, "roomMessage", {
            id: message.id,
            text,
            from: dbUser.username,
            createdAt: message.createdAt,
            mentions
        });

        const users = await this.prisma.user.findMany({ where: { nowRoom: data.room } });

        // Уведомления об упоминаниях
        for (const user of users) {
            if (user.username === username) continue;
            if (user.status === "offline") {
                await this.prisma.unreadMessage.create({
                    data: { messageId: message.id, userId: user.id }
                });
                this.broadcastToUser(user.username, "newOfflineMessageNotification", { from: username, room: data.room });
            }
        }

        for (const mention of mentions) {
            this.broadcastToUser(mention, "mentionNotification", { from: username, room: data.room, text });
        }

        this.resetAway(username);
    }

    // Лайк сообщения
    private async likeMessage(ws: any, data: LikeMessageData) {
        if (!data.messageId) return;

        const user = await this.prisma.user.findUnique({
            where: { username: data.user }
        });
        if (!user) return;

        const existingLike = await this.prisma.messageLike.findFirst({
            where: { messageId: data.messageId, userId: user.id }
        });

        if (existingLike) {
            await this.prisma.messageLike.delete({ where: { id: existingLike.id } });
        } else {
            await this.prisma.messageLike.create({
                data: {
                    messageId: data.messageId,
                    userId: user.id
                }
            });
        }

        const likes = await this.prisma.messageLike.findMany({
            where: { messageId: data.messageId },
            include: { user: true }
        });

        this.broadcastToAll("messageLiked", {
            messageId: data.messageId,
            likesCount: likes.length,
            likedBy: likes.map(like => like.user.username)
        });
    }

    // Выход из системы
    private async logout(ws: any, username: string) {
        await this.prisma.user.updateMany({ where: { username }, data: { status: "offline", nowRoom: null } });
        this.broadcastToAll("userStatusChanged", { username, status: "offline" });

        for (const room of ws.data.rooms) {
            if (!room.startsWith("user:")) {
                ws.unsubscribe(room);
                this.broadcastToRoom(room, "roomMessage", { message: `${username} вышел из комнаты` });
            }
        }

        ws.data.rooms = [];
    }

    // Отключение
    private async handleDisconnect(ws: any) {
        const username = ws.data.username;
        if (username) {
            await this.prisma.user.updateMany({ where: { username }, data: { status: "offline", nowRoom: null } });
            this.broadcastToAll("userStatusChanged", { username, status: "offline" });
        }
    }

    // Доп.
    private sendToSocket(ws: any, event: string, data: any) {
        ws.send(JSON.stringify({ type: event, data }));
    }

    private sendError(ws: any, message: string) {
        this.sendToSocket(ws, "errorMessage", { message });
    }

    private broadcastToAll(event: string, data: any) {
        this.server.publish("*", JSON.stringify({ type: event, data }));
    }

    private broadcastToRoom(room: string, event: string, data: any) {
        this.server.publish(room, JSON.stringify({ type: event, data }));
    }

    private broadcastToUser(username: string, event: string, data: any) {
        this.server.publish(`user:${username}`, JSON.stringify({ type: event, data }));
    }

    // Запуск сервера
    private start() {
        console.log(`Bun WebSocket server running on port: ${this.PORT}`);
    }
}

new BunSocketServer();