/**
 * Yuzik Voice Agent - Real-time Voice Conversation with Streaming and Interruption
 */

// Import VAD from CDN
// Note: In a production environment, you might want to install this via npm
const VAD_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.18/dist/bundle.min.js";

// ===========================
// State
// ===========================
const state = {
    isConnected: false,
    isConnected: false,
    isRecording: false,
    isProcessing: false,
    isSpeaking: false,
    audioContext: null,
    websocket: null,
    vad: null,
    userId: 'voice-user-' + Math.random().toString(36).substring(7),
    audioQueue: [],
    currentAudio: null,
    interruptRequested: false,
    isStreaming: false, // Debug: Am I currently sending chunks?
    lastVadEndTimestamp: 0, // Debug: Timestamp when VAD detected speech end
    firstProcessingTimestamp: 0, // Debug: Timestamp when sever sent "processing"
    firstAudioTimestamp: 0, // Debug: Timestamp when first audio chunk arrived
};

// ===========================
// DOM Elements
// ===========================
const elements = {
    connectionStatus: document.getElementById('connection-status'),
    connectionText: document.getElementById('connection-text'),
    micBtn: document.getElementById('mic-btn'),
    statusText: document.getElementById('status-text'),
    visualizer: document.getElementById('visualizer'),
    transcript: document.getElementById('transcript'),
    startBtn: document.getElementById('start-btn'),
    stopBtn: document.getElementById('stop-btn'),
    transcriptBox: document.querySelector('.transcript-box'),
};

// ===========================
// WebSocket Connection
// ===========================
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/voice?user_id=${state.userId}`;

    state.websocket = new WebSocket(wsUrl);

    state.websocket.onopen = () => {
        state.isConnected = true;
        updateConnectionStatus(true);
        console.log('WebSocket connected');
    };

    state.websocket.onclose = () => {
        state.isConnected = false;
        updateConnectionStatus(false);
        console.log('WebSocket disconnected');
        setTimeout(() => { if (!state.isConnected) connectWebSocket(); }, 3000);
    };

    state.websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateStatus('Памылка злучэння');
    };

    state.websocket.onmessage = async (event) => {
        try {
            if (event.data instanceof Blob) {
                // Audio chunk received from server (streaming TTS)
                if (state.firstAudioTimestamp === 0 && state.lastVadEndTimestamp > 0) {
                    state.firstAudioTimestamp = Date.now();
                    const latency = state.firstAudioTimestamp - state.lastVadEndTimestamp;
                    console.log(`[Perf] Client: First Audio Chunk Received. Latency (VAD End -> Audio): ${latency}ms`);
                }
                handleIncomingAudioChunk(event.data);
            } else {
                const data = JSON.parse(event.data);
                handleServerMessage(data);
            }
        } catch (error) {
            console.error('Error handling message:', error);
        }
    };
}

function updateConnectionStatus(connected) {
    if (elements.connectionStatus) {
        elements.connectionStatus.className = `connection-status ${connected ? 'connected' : 'disconnected'}`;
        elements.connectionText.textContent = connected ? 'Злучана' : 'Адключана';
    }
}

function handleServerMessage(data) {
    switch (data.type) {
        case 'transcript':
            updateTranscript(data.text);
            break;
        case 'processing':
            if (state.firstProcessingTimestamp === 0 && state.lastVadEndTimestamp > 0) {
                state.firstProcessingTimestamp = Date.now();
                const latency = state.firstProcessingTimestamp - state.lastVadEndTimestamp;
                console.log(`[Perf] Client: Server Processing Start. Latency (VAD End -> Processing): ${latency}ms`);
            }
            setProcessingState(true);
            break;
        case 'response':
            setProcessingState(false);
            updateTranscript(data.text, true);
            break;
        case 'error':
            setProcessingState(false);
            updateStatus('Памылка: ' + data.message);
            break;
        case 'interruption_handshake':
            console.log('Server acknowledged interruption');
            break;
    }
}

// ===========================
// Audio Playback (Streaming Queue)
// ===========================
// ===========================
// Audio Playback (Seamless via Web Audio API)
// ===========================

// Initialize Audio Context (must be done after user interaction)
function ensureAudioContext() {
    if (!state.audioContext) {
        state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (state.audioContext.state === 'suspended') {
        state.audioContext.resume();
    }
}

async function handleIncomingAudioChunk(blob) {
    ensureAudioContext();

    try {
        const arrayBuffer = await blob.arrayBuffer();
        // Decode the audio data asynchronously
        const audioBuffer = await state.audioContext.decodeAudioData(arrayBuffer);
        scheduleAudioBuffer(audioBuffer);
    } catch (e) {
        console.error("Error decoding audio chunk:", e);
    }
}

function scheduleAudioBuffer(buffer) {
    const source = state.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(state.audioContext.destination);

    const currentTime = state.audioContext.currentTime;

    // Logic for gapless playback:
    // If nextStartTime is in the past (or 0), we start "now" (+ small buffer).
    // Otherwise, we schedule it right after the previous chunk.
    if (!state.nextStartTime || state.nextStartTime < currentTime) {
        state.nextStartTime = currentTime + 0.05; // 50ms buffer for immediate start
    }

    source.start(state.nextStartTime);

    // Update next start time
    state.nextStartTime += buffer.duration;

    // Track source for interruption
    if (!state.scheduledSources) state.scheduledSources = [];
    state.scheduledSources.push(source);

    // Cleanup source from list when done (optional, but good for memory)
    source.onended = () => {
        const index = state.scheduledSources.indexOf(source);
        if (index > -1) {
            state.scheduledSources.splice(index, 1);
        }
    };

    // Handle UI "Speaking" state
    setSpeakingState(true);
    updateSpeakingTimeout();
}

function updateSpeakingTimeout() {
    // Clear existing timeout
    if (state.speakingTimeout) {
        clearTimeout(state.speakingTimeout);
    }

    if (!state.audioContext) return;

    // Calculate when the *last* scheduled audio will finish
    const timeRemaining = state.nextStartTime - state.audioContext.currentTime;

    if (timeRemaining > 0) {
        state.speakingTimeout = setTimeout(() => {
            setSpeakingState(false);
            state.nextStartTime = 0; // Reset timeline
        }, timeRemaining * 1000 + 200); // +200ms safety buffer
    } else {
        setSpeakingState(false);
    }
}

function stopAllPlayback() {
    // Stop all scheduled sources
    if (state.scheduledSources) {
        state.scheduledSources.forEach(source => {
            try { source.stop(); } catch (e) { /* ignore if already stopped */ }
        });
        state.scheduledSources = [];
    }

    // Reset timeline
    state.nextStartTime = 0;

    // clear timeout
    if (state.speakingTimeout) {
        clearTimeout(state.speakingTimeout);
        state.speakingTimeout = null;
    }

    setSpeakingState(false);
}

// ===========================
// VAD & Recording
// ===========================
async function initVAD() {
    if (state.vad) return;

    // Configure ONNX Runtime to load WASM from CDN
    if (window.ort) {
        window.ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/";
    }

    try {
        // Specify CDN URLs for worklet and model to avoid loading from local server root
        const baseUrl = "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.18/dist";
        state.vad = await window.vad.MicVAD.new({
            workletURL: `${baseUrl}/vad.worklet.bundle.min.js`,
            modelURL: `${baseUrl}/silero_vad.onnx`,
            onSpeechStart: () => {
                console.log("Speech started");
                state.isStreaming = true;
                if (state.isSpeaking) {
                    console.log("Interrupting... (Disabled for debugging)");
                    // handleInterruption();
                }
            },
            onSpeechEnd: (audio) => {
                console.log("Speech ended");
                state.isStreaming = false;

                if (state.isSpeaking) {
                    console.log("Ignored speech during playback (Anti-Echo)");
                    return;
                }

                if (state.isConnected && state.websocket.readyState === WebSocket.OPEN) {
                    state.lastVadEndTimestamp = Date.now();
                    state.firstProcessingTimestamp = 0;
                    state.firstAudioTimestamp = 0;
                    console.log(`[Perf] Client: VAD Speech End. Sending signal...`);

                    // We already sent the chunks in onFrameProcessed.
                    // Now we just signal the end.
                    state.websocket.send(JSON.stringify({ type: 'end_audio' }));
                }
            },
            onFrameProcessed: (probs, frame) => {
                updateVisualizerFromVAD(probs.isSpeech);

                // Stream chunks while speech is active
                if (state.isStreaming && state.isConnected && state.websocket.readyState === WebSocket.OPEN) {
                    // Convert frame (Float32Array) to Int16 raw bytes
                    const buffer = new ArrayBuffer(frame.length * 2);
                    const view = new DataView(buffer);
                    floatTo16BitPCM(view, 0, frame);
                    state.websocket.send(buffer);
                }
            },
            positiveSpeechThreshold: 0.8,
            negativeSpeechThreshold: 0.4,
            minSpeechFrames: 3,
        });
    } catch (e) {
        console.error("Failed to init VAD", e);
        updateStatus("Памылка ініцыялізацыі VAD");
    }
}

function handleInterruption() {
    stopAllPlayback();
    // Send interruption signal to backend
    if (state.websocket && state.websocket.readyState === WebSocket.OPEN) {
        state.websocket.send(JSON.stringify({ type: 'interrupt' }));
    }
}

function updateVisualizerFromVAD(isSpeech) {
    const bars = elements.visualizer.querySelectorAll('.visualizer-bar');
    if (!bars.length) return;

    bars.forEach(bar => {
        if (isSpeech || state.isSpeaking) {
            const height = 30 + Math.random() * 70;
            bar.style.height = height + '%';
        } else {
            bar.style.height = '20%';
        }
    });
}

// Helper to encode raw PCM to WAV
function encodeWAV(samples) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    /* RIFF identifier */
    writeString(view, 0, 'RIFF');
    /* RIFF chunk length */
    view.setUint32(4, 36 + samples.length * 2, true);
    /* RIFF type */
    writeString(view, 8, 'WAVE');
    /* format chunk identifier */
    writeString(view, 12, 'fmt ');
    /* format chunk length */
    view.setUint32(16, 16, true);
    /* sample format (raw) */
    view.setUint16(20, 1, true);
    /* channel count */
    view.setUint16(22, 1, true);
    /* sample rate */
    view.setUint32(24, 16000, true);
    /* byte rate (sample rate * block align) */
    view.setUint32(28, 16000 * 2, true);
    /* block align (channel count * bytes per sample) */
    view.setUint16(32, 2, true);
    /* bits per sample */
    view.setUint16(34, 16, true);
    /* data chunk identifier */
    writeString(view, 36, 'data');
    /* data chunk length */
    view.setUint32(40, samples.length * 2, true);

    floatTo16BitPCM(view, 44, samples);

    return buffer;
}

function floatTo16BitPCM(output, offset, input) {
    for (let i = 0; i < input.length; i++, offset += 2) {
        let s = Math.max(-1, Math.min(1, input[i]));
        output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

// ===========================
// UI Control
// ===========================
async function startSession() {
    try {
        await initVAD();
        await state.vad.start();
        state.isRecording = true;
        setListeningState(true);
        updateStatus("Слухаю... Можаце гаварыць.");
    } catch (e) {
        console.error("Start session failed", e);
    }
}

async function stopSession() {
    if (state.vad) {
        await state.vad.pause();
    }
    stopAllPlayback();
    state.isRecording = false;
    setListeningState(false);
}

function setListeningState(listening) {
    elements.micBtn.className = `mic-container ${listening ? 'listening' : ''}`;
    elements.visualizer.className = `audio-visualizer ${listening ? 'listening' : ''}`;
    elements.startBtn.disabled = listening;
    elements.stopBtn.disabled = !listening;
    if (listening) {
        elements.startBtn.classList.add('recording');
        elements.startBtn.innerHTML = '🔴 Працуе...';
        elements.statusText.classList.add('active');
    } else {
        elements.startBtn.classList.remove('recording');
        elements.startBtn.innerHTML = '🎤 Пачаць';
        elements.statusText.classList.remove('active');
        elements.visualizer.className = 'audio-visualizer';
    }
}

function setProcessingState(processing) {
    state.isProcessing = processing;
    if (processing) {
        elements.micBtn.className = 'mic-container processing';
        elements.visualizer.className = 'audio-visualizer processing';
        updateStatus('Апрацоўка...');
    } else {
        // If we stop processing but not speaking, return to listening if recording
        if (!state.isSpeaking && state.isRecording) {
            elements.micBtn.className = 'mic-container listening';
            elements.visualizer.className = 'audio-visualizer listening';
            updateStatus('Слухаю...');
        }
    }
}

function setSpeakingState(speaking) {
    state.isSpeaking = speaking;
    if (speaking) {
        state.isProcessing = false;
        elements.micBtn.className = 'mic-container speaking';
        elements.visualizer.className = 'audio-visualizer speaking';
        updateStatus('Юзік адказвае...');
        elements.statusText.classList.add('active');
    } else {
        elements.statusText.classList.remove('active');
        if (state.isRecording) {
            updateStatus('Слухаю...');
            elements.visualizer.className = 'audio-visualizer listening';
            elements.statusText.classList.add('active');
        } else {
            elements.micBtn.className = 'mic-container';
            elements.visualizer.className = 'audio-visualizer';
        }
    }
}

function updateStatus(text) {
    elements.statusText.textContent = text;
}

function updateTranscript(text, isResponse = false) {
    const prefix = isResponse ? '🤖 ' : '👤 ';
    elements.transcript.textContent = prefix + text;

    // Auto-scroll to bottom
    if (elements.transcriptBox) {
        elements.transcriptBox.scrollTop = elements.transcriptBox.scrollHeight;
    }
}

function createVisualizerBars() {
    const barCount = 32;
    elements.visualizer.innerHTML = '';
    for (let i = 0; i < barCount; i++) {
        const bar = document.createElement('div');
        bar.className = 'visualizer-bar';
        elements.visualizer.appendChild(bar);
    }
}

// ===========================
// Initialize
// ===========================
function init() {
    createVisualizerBars();
    connectWebSocket();

    elements.micBtn.addEventListener('click', () => {
        if (!state.isRecording) startSession();
        else stopSession();
    });

    elements.startBtn.addEventListener('click', () => {
        if (!state.isRecording) startSession();
    });

    elements.stopBtn.addEventListener('click', () => {
        stopSession();
    });
}

init();
