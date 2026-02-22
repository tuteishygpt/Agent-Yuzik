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
    recordingStream: null, // Mic stream for recording
    recordingProcessor: null, // ScriptProcessor for chunks
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
    // Perf log panel
    perfToggle: document.getElementById('perf-toggle'),
    perfPanel: document.getElementById('perf-panel'),
    perfLogBody: document.getElementById('perf-log-body'),
    perfClear: document.getElementById('perf-clear'),
    perfClose: document.getElementById('perf-close'),
};

// ===========================
// WebSocket Connection
// ===========================
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let host = window.location.host;

    // In development, connect directly to backend (port 7860) to avoid Vite proxy issues (ECONNRESET)
    if (import.meta.env.DEV) {
        host = `${window.location.hostname}:7861`;
    }

    const wsUrl = `${protocol}//${host}/api/voice?user_id=${state.userId}`;

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
                    addPerfEntry({
                        event: 'first_audio_received',
                        label: '📨 Першы аўдыя чанк атрыманы',
                        detail: `Затрымка (VAD → аўдыё): ${latency} мс`,
                        elapsed_ms: latency,
                        duration_ms: latency,
                    });
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
                addPerfEntry({
                    event: 'processing_start',
                    label: '⚙️ Сервер пачаў апрацоўку',
                    detail: `Затрымка (VAD → апрацоўка): ${latency} мс`,
                    elapsed_ms: latency,
                    duration_ms: latency,
                });
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
        case 'perf_log':
            // Structured performance log from server
            addPerfEntry(data);
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
    if (!state.nextStartTime || state.nextStartTime < currentTime) {
        state.nextStartTime = currentTime + 0.05; // 50ms buffer for immediate start
    }

    source.start(state.nextStartTime);

    // Track when playback actually starts (first buffer only)
    if (!state.playbackLogSent && state.lastVadEndTimestamp > 0) {
        const playbackLatency = Date.now() - state.lastVadEndTimestamp;
        addPerfEntry({
            event: 'audio_playback_start',
            label: '▶️ Пачалося прайграванне',
            detail: `Затрымка (VAD → гук): ${playbackLatency} мс`,
            elapsed_ms: playbackLatency,
            duration_ms: playbackLatency,
        });
        state.playbackLogSent = true;
    }

    // Update next start time
    state.nextStartTime += buffer.duration;

    // Track source for interruption
    if (!state.scheduledSources) state.scheduledSources = [];
    state.scheduledSources.push(source);

    // Cleanup source from list when done
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

// VAD & Recording
// ===========================
async function initVAD() {
    if (state.vad) return;

    // Configure ONNX Runtime to load WASM from CDN (v1.14.0 compatible)
    if (window.ort) {
        window.ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/";
        // Force single-threaded for stability on non-secure contexts
        window.ort.env.wasm.numThreads = 1;
        window.ort.env.wasm.simd = true;
    }

    try {
        state.vad = await window.vad.MicVAD.new({
            workletURL: "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.18/dist/vad.worklet.bundle.min.js",
            modelURL: "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.18/dist/silero_vad.onnx",
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
                    state.playbackLogSent = false;

                    // Add client-side perf log for VAD end / message sent
                    addPerfEntry({
                        event: 'user_message',
                        label: '🎙️ Паведамленне адпраўлена',
                        detail: 'VAD зафіксаваў канец мовы, аўдыё перадана на сервер',
                        elapsed_ms: 0,
                        duration_ms: 0,
                        _isSessionStart: true,
                    });

                    // We already sent the chunks in onFrameProcessed.
                    // Now we just signal the end.
                    state.websocket.send(JSON.stringify({ type: 'end_audio' }));
                }
            },
            onFrameProcessed: (probs) => {
                updateVisualizerFromVAD(probs.isSpeech);
            },
            positiveSpeechThreshold: 0.8,
            negativeSpeechThreshold: 0.4,
            minSpeechFrames: 3,
        });
    } catch (e) {
        console.error("Failed to init VAD", e);
        updateStatus("Памылка ініцыялізацыі VAD: " + e.message);
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
        // Check for secure context (required for getUserMedia)
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            const isSecure = window.isSecureContext;
            const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

            if (!isSecure && !isLocalhost) {
                updateStatus("⚠️ Патрэбна HTTPS або localhost для доступу да мікрафона");
                console.error("getUserMedia requires a secure context. Please access via https:// or http://localhost");
                return;
            }
            updateStatus("⚠️ Браўзер не падтрымлівае доступ да мікрафона");
            console.error("getUserMedia is not supported in this browser");
            return;
        }

        await initVAD();

        // Setup a separate 16kHz capture for streaming to Gemini
        // We do this manually because VAD internal worklet doesn't expose frames easily
        if (!state.recordingStream) {
            state.recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const context = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            const source = context.createMediaStreamSource(state.recordingStream);
            const processor = context.createScriptProcessor(4096, 1, 1);

            processor.onaudioprocess = (e) => {
                if (state.isStreaming && state.isConnected && state.websocket.readyState === WebSocket.OPEN) {
                    const inputData = e.inputBuffer.getChannelData(0);
                    const buffer = new ArrayBuffer(inputData.length * 2);
                    const view = new DataView(buffer);
                    floatTo16BitPCM(view, 0, inputData);
                    state.websocket.send(buffer);
                }
            };

            source.connect(processor);
            processor.connect(context.destination);
            state.recordingProcessor = { context, source, processor };
        }

        await state.vad.start();
        state.isRecording = true;
        setListeningState(true);
        updateStatus("Слухаю... Можаце гаварыць.");
    } catch (e) {
        console.error("Start session failed", e);
        updateStatus("Памылка: " + e.message);
    }
}

async function stopSession() {
    if (state.vad) {
        await state.vad.pause();
    }

    // Clean up recording pipeline
    if (state.recordingProcessor) {
        state.recordingProcessor.processor.disconnect();
        state.recordingProcessor.source.disconnect();
        state.recordingProcessor.context.close();
        state.recordingProcessor = null;
    }
    if (state.recordingStream) {
        state.recordingStream.getTracks().forEach(t => t.stop());
        state.recordingStream = null;
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
// Perf Log Panel
// ===========================
let perfLogCount = 0;

function formatTime(isoOrNull) {
    try {
        const d = isoOrNull ? new Date(isoOrNull) : new Date();
        return d.toLocaleTimeString('be-BY', { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
    } catch {
        return '--:--:--';
    }
}

function formatMs(ms) {
    if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
    return `${ms}ms`;
}

function addPerfEntry(data) {
    const body = elements.perfLogBody;
    if (!body) return;

    // Remove empty state on first entry
    const empty = body.querySelector('.perf-empty');
    if (empty) empty.remove();

    // Add session divider if this is a new user message (start of interaction)
    if (data._isSessionStart || data.event === 'user_message') {
        const divider = document.createElement('div');
        divider.className = 'perf-session-divider';
        divider.innerHTML = `<span class="perf-session-label">Сесія • ${formatTime(null)}</span>`;
        body.appendChild(divider);
    }

    const entry = document.createElement('div');
    entry.className = 'perf-entry';
    entry.setAttribute('data-event', data.event || '');

    const timeStr = formatTime(data.timestamp);
    const elapsedStr = data.elapsed_ms !== undefined && data.elapsed_ms > 0 ? formatMs(data.elapsed_ms) : '';

    entry.innerHTML = `
        <div class="perf-entry-header">
            <span class="perf-entry-label">${data.label || data.event || 'Падзея'}</span>
            <span class="perf-entry-time">${timeStr}</span>
        </div>
        ${data.detail ? `<div class="perf-entry-detail">${data.detail}</div>` : ''}
        ${elapsedStr ? `<span class="perf-entry-elapsed">+${elapsedStr}</span>` : ''}
    `;

    body.appendChild(entry);
    body.scrollTop = body.scrollHeight;
    perfLogCount++;

    // Pulse the toggle button if panel is closed
    if (!elements.perfPanel.classList.contains('open')) {
        elements.perfToggle.classList.add('has-new');
    }
}

function clearPerfLog() {
    if (elements.perfLogBody) {
        elements.perfLogBody.innerHTML = `
            <div class="perf-empty">
                <div class="perf-empty-icon">📊</div>
                <div class="perf-empty-text">Пачніце размову, каб бачыць логі</div>
            </div>
        `;
    }
    perfLogCount = 0;
}

function togglePerfPanel() {
    const panel = elements.perfPanel;
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
        elements.perfToggle.classList.remove('has-new');
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

    // Perf panel controls
    if (elements.perfToggle) {
        elements.perfToggle.addEventListener('click', togglePerfPanel);
    }
    if (elements.perfClose) {
        elements.perfClose.addEventListener('click', () => {
            elements.perfPanel.classList.remove('open');
        });
    }
    if (elements.perfClear) {
        elements.perfClear.addEventListener('click', clearPerfLog);
    }
}

init();
