/**
 * Yuzik Frontend - Main Chat Application
 */

// ===========================
// State Management
// ===========================
const state = {
    messages: [],
    isTyping: false,
    sessionId: null,
    userId: 'web-user-' + Math.random().toString(36).substring(7),
    pendingFiles: [],
    theme: localStorage.getItem('theme') || 'dark',
};

// ===========================
// DOM Elements
// ===========================
const elements = {
    emptyState: document.getElementById('empty-state'),
    chatView: document.getElementById('chat-view'),
    messagesContainer: document.getElementById('messages-container'),
    messageInput: document.getElementById('message-input'),
    sendBtn: document.getElementById('send-btn'),
    fileInput: document.getElementById('file-input'),
    filePreview: document.getElementById('file-preview'),
    btnClear: document.getElementById('btn-clear'),
    btnTheme: document.getElementById('btn-theme'),
    btnVoice: document.getElementById('btn-voice'),
    promptCards: document.querySelectorAll('.prompt-card'),
    // Modal
    imageModal: document.getElementById('image-modal'),
    modalImage: document.getElementById('modal-image'),
    modalClose: document.getElementById('modal-close'),
    zoomIn: document.getElementById('zoom-in'),
    zoomOut: document.getElementById('zoom-out'),
    downloadImage: document.getElementById('download-image'),
};

// ===========================
// API Functions
// ===========================
async function sendMessage(text, files = []) {
    const formData = new FormData();
    formData.append('text', text);
    formData.append('user_id', state.userId);

    for (const file of files) {
        formData.append('files', file);
    }

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Error sending message:', error);
        throw error;
    }
}

async function clearHistory() {
    try {
        await fetch('/api/chat/history', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: state.userId }),
        });
    } catch (error) {
        console.error('Error clearing history:', error);
    }
}

// ===========================
// UI Functions
// ===========================
function showChatView() {
    elements.emptyState.classList.add('hidden');
    elements.chatView.classList.remove('hidden');
}

function showEmptyState() {
    elements.emptyState.classList.remove('hidden');
    elements.chatView.classList.add('hidden');
}

function addMessage(role, content, type = 'text') {
    const message = { role, content, type, id: Date.now() };
    state.messages.push(message);
    renderMessage(message);
    scrollToBottom();
}

function renderMessage(message) {
    const messageEl = document.createElement('div');
    messageEl.className = `message ${message.role}`;
    messageEl.dataset.id = message.id;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = message.role === 'user' ? '👤' : '🤖';

    const contentEl = document.createElement('div');
    contentEl.className = 'message-content';

    if (message.type === 'text') {
        contentEl.innerHTML = formatMarkdown(message.content);
    } else if (message.type === 'image') {
        contentEl.innerHTML = createImageMessage(message.content);
    } else if (message.type === 'audio') {
        contentEl.innerHTML = createAudioMessage(message.content);
    }

    messageEl.appendChild(avatar);
    messageEl.appendChild(contentEl);
    elements.messagesContainer.appendChild(messageEl);
}

function formatMarkdown(text) {
    // Simple markdown formatting
    return text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`(.*?)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
}

function createImageMessage(src) {
    return `
    <div class="image-message" data-src="${src}">
      <img src="${src}" alt="Image" loading="lazy">
    </div>
  `;
}

function createAudioMessage(src) {
    const id = 'audio-' + Date.now();
    return `
    <div class="audio-message" data-audio-id="${id}">
      <button class="audio-play-btn" data-playing="false">▶️</button>
      <div class="audio-progress">
        <input type="range" class="audio-slider" value="0" min="0" max="100">
        <span class="audio-time">0:00 / 0:00</span>
      </div>
      <button class="audio-volume">🔊</button>
      <audio src="${src}" preload="metadata" style="display:none"></audio>
    </div>
  `;
}

function showTypingIndicator() {
    if (state.isTyping) return;
    state.isTyping = true;

    const indicator = document.createElement('div');
    indicator.className = 'message bot';
    indicator.id = 'typing-indicator';

    indicator.innerHTML = `
    <div class="message-avatar">🤖</div>
    <div class="message-content">
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>
  `;

    elements.messagesContainer.appendChild(indicator);
    scrollToBottom();
}

function hideTypingIndicator() {
    state.isTyping = false;
    const indicator = document.getElementById('typing-indicator');
    if (indicator) {
        indicator.remove();
    }
}

function scrollToBottom() {
    elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
}

function clearChat() {
    state.messages = [];
    elements.messagesContainer.innerHTML = '';
    showEmptyState();
    clearHistory();
}

// ===========================
// File Handling
// ===========================
function handleFileSelect(event) {
    const files = Array.from(event.target.files);

    for (const file of files) {
        state.pendingFiles.push(file);
        renderFilePreview(file);
    }

    elements.filePreview.classList.remove('hidden');
    event.target.value = '';
}

function renderFilePreview(file) {
    const item = document.createElement('div');
    item.className = 'file-preview-item';
    item.dataset.name = file.name;

    if (file.type.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        item.appendChild(img);
    } else {
        const icon = document.createElement('div');
        icon.className = 'file-icon';
        icon.textContent = file.type.includes('audio') ? '🎵' : '📄';
        item.appendChild(icon);
    }

    const removeBtn = document.createElement('button');
    removeBtn.className = 'file-preview-remove';
    removeBtn.textContent = '✕';
    removeBtn.onclick = () => removeFilePreview(file.name);
    item.appendChild(removeBtn);

    elements.filePreview.appendChild(item);
}

function removeFilePreview(fileName) {
    state.pendingFiles = state.pendingFiles.filter(f => f.name !== fileName);
    const item = elements.filePreview.querySelector(`[data-name="${fileName}"]`);
    if (item) item.remove();

    if (state.pendingFiles.length === 0) {
        elements.filePreview.classList.add('hidden');
    }
}

function clearFilePreview() {
    state.pendingFiles = [];
    elements.filePreview.innerHTML = '';
    elements.filePreview.classList.add('hidden');
}

// ===========================
// Theme
// ===========================
function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', state.theme);
    localStorage.setItem('theme', state.theme);
}

// ===========================
// Image Modal
// ===========================
let currentZoom = 1;

function openImageModal(src) {
    elements.modalImage.src = src;
    elements.imageModal.classList.remove('hidden');
    currentZoom = 1;
    elements.modalImage.style.transform = `scale(${currentZoom})`;
}

function closeImageModal() {
    elements.imageModal.classList.add('hidden');
}

function zoomImage(factor) {
    currentZoom = Math.max(0.5, Math.min(3, currentZoom + factor));
    elements.modalImage.style.transform = `scale(${currentZoom})`;
}

function downloadCurrentImage() {
    const link = document.createElement('a');
    link.href = elements.modalImage.src;
    link.download = 'yuzik-image-' + Date.now() + '.png';
    link.click();
}

// ===========================
// Audio Player
// ===========================
function initAudioPlayer(container) {
    const audio = container.querySelector('audio');
    const playBtn = container.querySelector('.audio-play-btn');
    const slider = container.querySelector('.audio-slider');
    const timeDisplay = container.querySelector('.audio-time');
    const volumeBtn = container.querySelector('.audio-volume');

    let isMuted = false;

    audio.addEventListener('loadedmetadata', () => {
        slider.max = Math.floor(audio.duration);
        timeDisplay.textContent = `0:00 / ${formatTime(audio.duration)}`;
    });

    audio.addEventListener('timeupdate', () => {
        slider.value = Math.floor(audio.currentTime);
        timeDisplay.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
    });

    audio.addEventListener('ended', () => {
        playBtn.textContent = '▶️';
        playBtn.dataset.playing = 'false';
    });

    playBtn.addEventListener('click', () => {
        if (playBtn.dataset.playing === 'true') {
            audio.pause();
            playBtn.textContent = '▶️';
            playBtn.dataset.playing = 'false';
        } else {
            // Pause all other audio
            document.querySelectorAll('.audio-message audio').forEach(a => {
                if (a !== audio) {
                    a.pause();
                    a.parentElement.querySelector('.audio-play-btn').textContent = '▶️';
                    a.parentElement.querySelector('.audio-play-btn').dataset.playing = 'false';
                }
            });
            audio.play();
            playBtn.textContent = '⏸️';
            playBtn.dataset.playing = 'true';
        }
    });

    slider.addEventListener('input', () => {
        audio.currentTime = slider.value;
    });

    volumeBtn.addEventListener('click', () => {
        isMuted = !isMuted;
        audio.muted = isMuted;
        volumeBtn.textContent = isMuted ? '🔇' : '🔊';
    });
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ===========================
// Voice Agent
// ===========================
function openVoiceAgent() {
    const isMobile = window.innerWidth <= 600 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    if (isMobile) {
        // On mobile, just navigate or open in a new tab without fixed dimensions
        window.open('/voice.html', '_blank');
        return;
    }

    const width = 500;
    const height = 750;
    const left = (screen.width - width) / 2;
    const top = (screen.height - height) / 2;

    window.open(
        '/voice.html',
        'VoiceAgent',
        `width=${width},height=${height},left=${left},top=${top},resizable=yes`
    );
}

// ===========================
// Message Handling
// ===========================
async function handleSendMessage() {
    const text = elements.messageInput.value.trim();
    const files = [...state.pendingFiles];

    if (!text && files.length === 0) return;

    // Show chat view
    showChatView();

    // Add user message
    if (text) {
        addMessage('user', text, 'text');
    }

    // Add file messages
    for (const file of files) {
        if (file.type.startsWith('image/')) {
            addMessage('user', URL.createObjectURL(file), 'image');
        } else if (file.type.startsWith('audio/')) {
            addMessage('user', URL.createObjectURL(file), 'audio');
        } else {
            addMessage('user', `📄 ${file.name}`, 'text');
        }
    }

    // Clear input
    elements.messageInput.value = '';
    clearFilePreview();

    // Show typing indicator
    showTypingIndicator();

    try {
        const response = await sendMessage(text, files);
        hideTypingIndicator();

        // Handle response
        if (response.text) {
            addMessage('bot', response.text, 'text');
        }

        if (response.audio) {
            addMessage('bot', response.audio, 'audio');
            // Initialize audio player after DOM update
            setTimeout(() => {
                const audioMessages = document.querySelectorAll('.audio-message:not([data-initialized])');
                audioMessages.forEach(container => {
                    initAudioPlayer(container);
                    container.dataset.initialized = 'true';
                });
            }, 100);
        }

        if (response.image) {
            addMessage('bot', response.image, 'image');
        }
    } catch (error) {
        hideTypingIndicator();
        addMessage('bot', 'Прабачце, адбылася памылка. Паспрабуйце яшчэ раз.', 'text');
    }
}

// ===========================
// Event Listeners
// ===========================
function initEventListeners() {
    // Send message
    elements.sendBtn.addEventListener('click', handleSendMessage);
    elements.messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    // File upload
    elements.fileInput.addEventListener('change', handleFileSelect);

    // Prompt cards
    elements.promptCards.forEach(card => {
        card.addEventListener('click', () => {
            const prompt = card.dataset.prompt;
            elements.messageInput.value = prompt;
            handleSendMessage();
        });
    });

    // Clear chat
    elements.btnClear.addEventListener('click', clearChat);

    // Theme toggle
    elements.btnTheme.addEventListener('click', toggleTheme);

    // Voice agent
    elements.btnVoice.addEventListener('click', openVoiceAgent);

    // Image modal
    elements.modalClose.addEventListener('click', closeImageModal);
    elements.imageModal.querySelector('.modal-overlay').addEventListener('click', closeImageModal);
    elements.zoomIn.addEventListener('click', () => zoomImage(0.25));
    elements.zoomOut.addEventListener('click', () => zoomImage(-0.25));
    elements.downloadImage.addEventListener('click', downloadCurrentImage);

    // Delegate click for image messages
    elements.messagesContainer.addEventListener('click', (e) => {
        const imageMessage = e.target.closest('.image-message');
        if (imageMessage) {
            openImageModal(imageMessage.dataset.src);
        }
    });

    // Escape key to close modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !elements.imageModal.classList.contains('hidden')) {
            closeImageModal();
        }
    });
}

// ===========================
// Initialize
// ===========================
function init() {
    // Apply saved theme
    document.documentElement.setAttribute('data-theme', state.theme);

    // Initialize event listeners
    initEventListeners();

    console.log('Yuzik Frontend initialized');
}

// Start app
init();
