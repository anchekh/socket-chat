const socket = new WebSocket("ws://localhost:3000/ws");

// Окна
const loginWindow = document.getElementById("login");
const chatWindow = document.getElementById("chat");
const roomCreateWindow = document.getElementById("room-create");
const membersWindow = document.getElementById("members");
const actionsWindow = document.getElementById("room-actions");
const chatNotice = document.getElementById("chat__notice");

// Элементы
const loginInput = document.getElementById("login__input");
const loginButton = document.getElementById("login__button");
const chatExitButton = document.getElementById("chat__exit");
const openRoomCreateWindowButton = document.getElementById("chat__add-room");
const roomCreateButton = document.getElementById("room-create__submit");
const closeRoomCreateWindowButton = document.getElementById("room-create__close");
const openMembersWindowButton = document.getElementById("chat__room-members");
const closeMembersWindowButton = document.getElementById("members__close");
const sendMessageButton = document.getElementById("chat__send");
const joinRoomButton = document.getElementById("chat-room__join");
const leaveRoomButton = document.getElementById("chat-room__leave");
const joinOrLeaveButton = document.getElementById("room-actions__submit");
const closeActionsWindowButton = document.getElementById("room-actions__close");
const chatRoomElement = document.getElementById("chat-room");
const reaction = document.getElementById("message__reaction");
const messageInput = document.getElementById("chat__message-input");
const messagesContainer = document.querySelector(".chat__messages");

let currentUser = null;
let currentRoom = null;
let typingTimer = null;

// Функция отправки события на сервер
function emit(eventType, data) {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: eventType, data }));
        console.log("emit", eventType, data);
    } else {
        console.error("WebSocket not connected");
    }
}

// Добавление сообщения
function appendMessage(message) {
    const container = document.createElement("div");
    container.className = "message-item";
    container.dataset.id = message.id || ("temp-" + Date.now());

    const messageContent = document.createElement("div");
    messageContent.className = "message-content";
    messageContent.style.display = "flex";
    messageContent.style.alignItems = "center";
    messageContent.style.gap = "8px";

    const sender = document.createElement("div");
    sender.className = "message__sender";
    sender.textContent = (message.from ? message.from : "DefaultUser") + ":";

    const text = document.createElement("div");
    text.className = "message__text";
    const html = (message.text || "").replace(/@([a-zA-Z0-9_]+)/g, (match, name) => `<span class="mention">@${name}</span>`);
    text.innerHTML = html;

    const reactionWrap = document.createElement("div");
    reactionWrap.className = "message__reaction-wrap";
    reactionWrap.innerHTML = `<div class="message__reaction" data-id="${container.dataset.id}" style="color: #ff548e; display: flex; align-items: center; gap: 4px;">❤<span class="like-count"></span></div>`;

    messageContent.appendChild(sender);
    messageContent.appendChild(text);
    messageContent.appendChild(reactionWrap);
    
    container.appendChild(messageContent);
    messagesContainer.appendChild(container);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    const reactionBtn = container.querySelector(".message__reaction");
    reactionBtn.addEventListener("click", () => {
        const messageId = message.id;
        emit("likeMessage", { user: currentUser, messageId });
        console.log(`User ${currentUser} liked message`, messageId);
    });
}

// Авторизация
loginButton.addEventListener("click", () => {
    const username = loginInput.value.trim();
    if (!username) return alert("Введите имя пользователя");
    
    currentUser = username;
    loginWindow.style.display = "none";
    chatWindow.style.display = "flex";
    chatNotice.style.display = "flex";
    
    emit("login", { user: currentUser });
    console.log(`User ${currentUser} logged in`);
});

// Выход из чата
chatExitButton.addEventListener("click", () => {
    if (currentUser) emit("logout", currentUser);
    
    chatWindow.style.display = "none";
    loginWindow.style.display = "flex";
    console.log(`User ${currentUser} logged out`);
    
    currentUser = null;
    currentRoom = null;
});

// Открытие окна создания комнаты
openRoomCreateWindowButton.addEventListener("click", () => {
    roomCreateWindow.style.display = "flex";
});

// Создание комнаты
roomCreateButton.addEventListener("click", () => {
    const roomName = document.getElementById("room-create__name").value.trim();
    const roomType = document.querySelector('input[name="room-type"]:checked')?.value;
    const members = document.getElementById("room-create__members").value.split(",").map(member => member.trim()).filter(Boolean);
    
    if (!roomName || !roomType) return alert("Введите все поля");
    
    emit("createRoom", { 
        roomName: roomName, 
        type: roomType === "private" ? "private" : "public", 
        members, 
        inviter: currentUser 
    });
    
    roomCreateWindow.style.display = "none";
    console.log(`User ${currentUser} created room ${roomName}`);
});

// Закрытие окна создания комнаты
closeRoomCreateWindowButton.addEventListener("click", () => {
    roomCreateWindow.style.display = "none";
});

// Открытие окна списка участников
openMembersWindowButton.addEventListener("click", () => {
    membersWindow.style.display = "flex";
});

// Закрытие окна списка участников
closeMembersWindowButton.addEventListener("click", () => {
    membersWindow.style.display = "none";
});

// Открытие окна действий (вход/выход из комнаты)
joinRoomButton.addEventListener("click", () => { 
    actionsWindow.style.display = "flex"; 
});

// Открытие окна действий (вход/выход из комнаты)
leaveRoomButton.addEventListener("click", () => { 
    actionsWindow.style.display = "flex"; 
});

// Закрытие окна действий (вход/выход из комнаты)
closeActionsWindowButton.addEventListener("click", () => { 
    actionsWindow.style.display = "none"; 
});

// Вход или выход из комнаты
joinOrLeaveButton.addEventListener("click", () => {
    const action = document.querySelector('input[name="room-actions-type"]:checked')?.value;
    const roomName = document.getElementById("room-actions__input").value.trim();
    
    if (!action || !roomName) return alert("Заполните поле");
    
    if (action === "join") {
        emit("joinRoom", { user: currentUser, room: roomName });
        currentRoom = roomName;
        document.getElementById("chat__room-name").textContent = roomName;
        chatNotice.style.display = "none";
        console.log(`User ${currentUser} joined room ${roomName}`);
    } else {
        emit("leaveRoom", { user: currentUser, room: roomName });
        console.log(`User ${currentUser} left room ${roomName}`);
        if (currentRoom === roomName) currentRoom = null;
    }
    
    actionsWindow.style.display = "none";
});

// Скрытие уведомления
chatRoomElement.addEventListener("click", () => {
    chatNotice.style.display = "none";
});

// Отправка сообщения
sendMessageButton.addEventListener("click", () => {
    const messageText = messageInput.value.trim();
    if (!messageText) return;
    if (!currentRoom) return alert("Сначала присоединитесь к комнате");
    if (messageText.length > 300) return alert("Сообщение слишком длинное");
    
    emit("message", { user: currentUser, room: currentRoom, text: messageText });
    messageInput.value = "";
    console.log(`User ${currentUser} sent a message`);
});

// + Enter
messageInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
        sendMessageButton.click();
    }
});

// ОВВод сообщения
messageInput.addEventListener("input", () => {
    if (!currentUser || !currentRoom) return;
    
    emit("typing", { user: currentUser });
    
    // Таймер
    if (typingTimer) clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
        emit("typing", { user: currentUser });
    }, 1000);
});

// Лайк
if (reaction) {
    reaction.addEventListener("click", () => {
        reaction.style.color = reaction.style.color === "rgb(255, 84, 142)" ? "" : "#ff548e";
    });
}

// Серверные сообщения
socket.onmessage = (event) => {
    try {
        const message = JSON.parse(event.data);
        console.log("socket message:", message.type, message.data);
        
        switch (message.type) {
            case "offlineMessages":
                alert(`У вас ${message.data.length} офлайн сообщений`);
                message.data.forEach(msg => appendMessage({ 
                    id: msg.id, 
                    text: msg.text, 
                    from: msg.from, 
                    createdAt: msg.createdAt 
                }));
                break;
                
            case "roomMessage":
                appendMessage(message.data);
                break;
                
            case "joinedRoom":
                if (message.data.roomName) {
                    currentRoom = message.data.roomName;
                    document.getElementById("chat__room-name").textContent = message.data.roomName;
                }
                break;
                
            case "roomUsers":
                document.getElementById("chat__room-members").textContent = "Участники: " + (message.data?.length ?? 0);
                break;
                
            case "userStatusChanged":
                console.log("User status changed:", message.data);
                break;
                
            case "mentionNotification":
                alert(`Вас упомянул ${message.data.from} в ${message.data.room}`);
                break;
                
            case "messageLiked":
                const messageElement = document.querySelector(`[data-id="${message.data.messageId}"]`);
                if (messageElement) {
                    const likeCountElement = messageElement.querySelector(".like-count");
                    if (likeCountElement) likeCountElement.textContent = ` ${message.data.likesCount}`;
                }
                break;
                
            case "errorMessage":
                alert(message.data.message || "Ошибка");
                break;
                
            case "roomCreated":
                console.log("Room created:", message.data);
                break;
                
            case "newOfflineMessageNotification":
                alert(`Новое офлайн сообщение от ${message.data.from} в ${message.data.room}`);
                break;
                
            default:
                console.log("Unknown message type:", message.type);
        }
    } catch (error) {
        console.error("Message parsing error:", error);
    }
};

socket.onopen = () => {
    console.log("Connected to Bun WebSocket server");
};

socket.onclose = () => {
    console.log("Connection closed");
};

socket.onerror = (error) => {
    console.error("WebSocket error:", error);
};

window.addEventListener("beforeunload", () => {
    if (currentUser) {
        emit("logout", currentUser);
    }
});