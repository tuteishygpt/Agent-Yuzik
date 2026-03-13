/**
 * Yuzik Voice Agent - Real-time Voice Conversation with Streaming and Interruption
 * Uses ScriptProcessor-based PCM player for minimal latency (inspired by Colab streaming).
 */

// Import VAD from CDN
const VAD_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.18/dist/bundle.min.js";

// ===========================
// Speakerphone (loudspeaker) helper for mobile devices
// On iOS/Android, AudioContext may route to earpiece instead of loudspeaker.
// Playing a silent <audio> element BEFORE creating AudioContext forces the
// system to route all subsequent audio output through the loudspeaker.
// ===========================
const speakerphone = {
    _activated: false,
    _audioEl: null,

    /** Detect mobile / touch device */
    _isMobile() {
        return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
            || ('ontouchstart' in window)
            || (navigator.maxTouchPoints > 0);
    },

    /**
     * Generate a tiny silent WAV data URI (44 bytes header + 1600 samples = ~3.2kB).
     * 16kHz mono, 100ms of silence — enough to claim the loudspeaker route.
     */
    _silentWavDataUri() {
        const sampleRate = 16000;
        const numSamples = 1600; // 100ms
        const byteRate = sampleRate * 2;
        const dataSize = numSamples * 2;
        const buffer = new ArrayBuffer(44 + dataSize);
        const view = new DataView(buffer);
        // RIFF header
        const writeStr = (offset, str) => {
            for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
        };
        writeStr(0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        writeStr(8, 'WAVE');
        writeStr(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeStr(36, 'data');
        view.setUint32(40, dataSize, true);
        // samples are already 0 (silence)
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return 'data:audio/wav;base64,' + btoa(binary);
    },

    /**
     * Force loudspeaker output on mobile devices.
     * Must be called inside a user gesture (click/tap) handler.
     * Returns a promise that resolves when the speaker route is claimed.
     */
    async activate() {
        if (this._activated) return;
        if (!this._isMobile()) {
            console.log('[Speakerphone] Desktop detected — skipping');
            this._activated = true;
            return;
        }

        console.log('[Speakerphone] Mobile detected — forcing loudspeaker...');

        try {
            // Create a hidden <audio> element and play silent audio
            const audio = document.createElement('audio');
            audio.setAttribute('playsinline', '');
            audio.setAttribute('webkit-playsinline', '');
            audio.volume = 1.0; // must be non-zero to claim the speaker
            audio.src = this._silentWavDataUri();
            document.body.appendChild(audio);
            this._audioEl = audio;

            await audio.play();
            console.log('[Speakerphone] ✅ Silent audio played — loudspeaker route claimed');

            // Keep the element alive (removing it may release the speaker route on some devices)
            // Clean up after a safe delay
            audio.addEventListener('ended', () => {
                // Do NOT remove the element — some iOS versions release the speaker route
                // audio.remove();
                console.log('[Speakerphone] Silent audio ended (element kept alive)');
            });

            this._activated = true;
        } catch (e) {
            console.warn('[Speakerphone] Could not play silent audio:', e);
            // Mark as activated anyway to avoid retrying
            this._activated = true;
        }
    },

    /** Re-activate loudspeaker if needed (e.g. after AudioContext resume) */
    async ensureActive() {
        if (!this._isMobile()) return;
        if (this._audioEl && this._audioEl.paused) {
            try {
                this._audioEl.src = this._silentWavDataUri();
                await this._audioEl.play();
                console.log('[Speakerphone] Re-activated loudspeaker route');
            } catch (e) {
                console.warn('[Speakerphone] Re-activation failed:', e);
            }
        }
    }
};

// ===========================
// Audio Session helper (navigator.audioSession API, Chrome 128+)
// Sets session type to 'playback' during bot response → forces loudspeaker.
// Falls back silently on browsers that don't support it.
// ===========================
const audioSessionHelper = {
    _supported: typeof navigator !== 'undefined' && 'audioSession' in navigator,

    setPlayback() {
        if (!this._supported) return;
        try {
            navigator.audioSession.type = 'playback';
            console.log('[AudioSession] type → playback (loudspeaker)');
        } catch (e) {
            console.warn('[AudioSession] setPlayback failed:', e);
        }
    },

    setAuto() {
        if (!this._supported) return;
        try {
            navigator.audioSession.type = 'auto';
            console.log('[AudioSession] type → auto');
        } catch (e) {
            console.warn('[AudioSession] setAuto failed:', e);
        }
    }
};

// ===========================
// PCM Audio Player (ScriptProcessor-based, minimal latency)
// Directly writes Float32 samples to output — no decodeAudioData overhead.
// ===========================
const pcmPlayer = {
    ctx: null,
    node: null,
    queue: [],
    playing: false,
    _firstSampleFired: false,
    _emptyTimeout: null,
    _bufferTimeout: null,
    _chunkCount: 0,
    _totalSamples: 0,
    _pushTimestamp: 0,
    sampleRate: 24000,
    scriptBufferSize: 1024,     // ScriptProcessor buffer (~42ms at 24kHz, Colab-style)
    minBufferMs: 0,             // Start immediately (Colab-style, no pre-buffering)
    emptyGraceMs: 150,          // Grace period before declaring playback ended

    init(sampleRate) {
        sampleRate = sampleRate || this.sampleRate;
        if (this.ctx) {
            if (this.ctx.sampleRate !== sampleRate) this.destroy();
            else return;
        }
        this.sampleRate = sampleRate;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { console.error('[PCM Player] AudioContext not supported'); return; }

        // Ensure loudspeaker route is claimed before creating AudioContext
        speakerphone.ensureActive();

        // latencyHint: 'playback' часта прымушае мабільныя браўзеры выкарыстоўваць асноўны дынамік
        this.ctx = new AC({
            sampleRate,
            latencyHint: 'playback'
        });
        // 2-channel (stereo) output — forces loudspeaker on mobile
        // (mono ScriptProcessor output is sometimes routed to earpiece)
        this.node = this.ctx.createScriptProcessor(this.scriptBufferSize, 1, 2);
        const self = this;

        this.node.onaudioprocess = (e) => {
            const outL = e.outputBuffer.getChannelData(0);
            const outR = e.outputBuffer.getChannelData(1);
            let i = 0;

            while (i < outL.length) {
                if (self.queue.length === 0 || !self.playing) {
                    outL[i] = 0.0;
                    outR[i] = 0.0;
                    i++;
                    continue;
                }
                if (!self._firstSampleFired) {
                    self._firstSampleFired = true;
                    const now = performance.now();
                    const latencyFromPush = now - self._pushTimestamp;
                    console.log(`[PCM Player] ▶️ First sample output: ${latencyFromPush.toFixed(1)} ms after first push`);
                    if (state.lastVadEndTimestamp > 0) {
                        const totalLatency = Date.now() - state.lastVadEndTimestamp;
                        addPerfEntry({
                            event: 'pcm_playback_start',
                            label: '▶️ Рэальны пачатак гуку',
                            detail: `VAD→гук: ${totalLatency} мс | буфер→гук: ${latencyFromPush.toFixed(0)} мс`,
                            elapsed_ms: totalLatency,
                            duration_ms: totalLatency,
                        });
                    }
                }
                let cur = self.queue[0];
                const take = Math.min(cur.length, outL.length - i);
                // Duplicate mono → L + R
                for (let j = 0; j < take; j++) {
                    outL[i + j] = cur[j];
                    outR[i + j] = cur[j];
                }
                i += take;
                if (take === cur.length) self.queue.shift();
                else self.queue[0] = cur.subarray(take);
            }

            // Queue emptied — start grace countdown
            if (self.playing && self.queue.length === 0) {
                if (!self._emptyTimeout) {
                    self._emptyTimeout = setTimeout(() => {
                        if (self.queue.length === 0 && self.playing) {
                            self.playing = false;
                            self._emptyTimeout = null;
                            const stats = self.getStats();
                            console.log(`[PCM Player] ⏹ Done: ${stats.chunks} chunks, ${stats.totalMs} ms audio`);
                            setSpeakingState(false);
                        }
                    }, self.emptyGraceMs);
                }
            }
        };

        this.node.connect(this.ctx.destination);
        const bufMs = (this.scriptBufferSize / sampleRate * 1000).toFixed(0);
        console.log(`[PCM Player] Init: ${sampleRate} Hz, STEREO, buffer=${this.scriptBufferSize} (${bufMs} ms), minBuf=${this.minBufferMs} ms`);
    },

    /** Get total buffered ms */
    _bufferedMs() {
        const samples = this.queue.reduce((s, a) => s + a.length, 0);
        return samples / this.sampleRate * 1000;
    },

    _startPlayback() {
        this.playing = true;
        this._pushTimestamp = performance.now();
        setSpeakingState(true);
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
        if (this._bufferTimeout) {
            clearTimeout(this._bufferTimeout);
            this._bufferTimeout = null;
        }
        const bMs = this._bufferedMs();
        console.log(`[PCM Player] ▶ Start playback: buffered=${bMs.toFixed(0)} ms, chunks=${this._chunkCount}`);
    },

    push(f32array) {
        if (!this.ctx) this.init(this.sampleRate);
        this.queue.push(f32array);
        this._chunkCount++;
        this._totalSamples += f32array.length;

        if (this._emptyTimeout) {
            clearTimeout(this._emptyTimeout);
            this._emptyTimeout = null;
        }

        // Start playing when minimum buffer is reached, or fallback after timeout
        if (!this.playing && this.queue.length > 0) {
            if (this._bufferedMs() >= this.minBufferMs) {
                this._startPlayback();
            } else if (!this._bufferTimeout) {
                this._bufferTimeout = setTimeout(() => {
                    if (!this.playing && this.queue.length > 0) {
                        this._startPlayback();
                    }
                }, this.minBufferMs);
            }
        }
    },

    reset() {
        this.playing = false;
        this.queue.length = 0;
        this._firstSampleFired = false;
        this._chunkCount = 0;
        this._totalSamples = 0;
        this._pushTimestamp = 0;
        if (this._emptyTimeout) { clearTimeout(this._emptyTimeout); this._emptyTimeout = null; }
        if (this._bufferTimeout) { clearTimeout(this._bufferTimeout); this._bufferTimeout = null; }
    },

    destroy() {
        this.reset();
        if (this.node) { this.node.disconnect(); this.node = null; }
        if (this.ctx) { this.ctx.close().catch(() => { }); this.ctx = null; }
    },

    getStats() {
        return {
            chunks: this._chunkCount,
            totalMs: (this._totalSamples / this.sampleRate * 1000).toFixed(0),
            queueMs: this._bufferedMs().toFixed(0),
            queueChunks: this.queue.length,
        };
    }
};

// ===========================
// State
// ===========================
const state = {
    isConnected: false,
    isRecording: false,
    isProcessing: false,
    isSpeaking: false,
    audioContext: null,
    websocket: null,
    vad: null,
    _vadPaused: false,  // true when VAD is paused during bot response
    userId: 'voice-user-' + Math.random().toString(36).substring(7),
    audioQueue: [],
    currentAudio: null,
    interruptRequested: false,
    isStreaming: false,
    recordingStream: null,
    recordingProcessor: null,
    lastVadEndTimestamp: 0,
    firstProcessingTimestamp: 0,
    firstAudioTimestamp: 0,
    // PCM tracking
    firstPcmReceived: false,
    pcmChunkCount: 0,
    // Legacy BufferSource tracking
    nextStartTime: 0,
    scheduledSources: [],
    speakingTimeout: null,
    playbackLogSent: false,
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
                const ab = await event.data.arrayBuffer();
                // Check for binary PCM header: "PCM\0" (4 bytes) + uint32 samples (4 bytes)
                if (ab.byteLength >= 8) {
                    const hdr = new Uint8Array(ab, 0, 4);
                    if (hdr[0] === 0x50 && hdr[1] === 0x43 && hdr[2] === 0x4D && hdr[3] === 0x00) {
                        // Binary PCM from local TTS — zero-copy Float32, no base64 decode
                        const f32 = new Float32Array(ab, 8);
                        handleBinaryPcmChunk(f32);
                        return;
                    }
                }
                // Legacy WAV blob (API mode / ADK artifacts)
                if (state.firstAudioTimestamp === 0 && state.lastVadEndTimestamp > 0) {
                    state.firstAudioTimestamp = Date.now();
                    const latency = state.firstAudioTimestamp - state.lastVadEndTimestamp;
                    addPerfEntry({
                        event: 'first_audio_received',
                        label: '📨 Першы аўдыя чанк (WAV)',
                        detail: `Затрымка (VAD → аўдыё): ${latency} мс`,
                        elapsed_ms: latency,
                        duration_ms: latency,
                    });
                }
                handleIncomingAudioChunk(new Blob([ab]));
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
            // Не здымаем processing тут, чакаем пачатку аўдыё (setSpeakingState)
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
            addPerfEntry(data);
            break;

        // ── Server config (sent on WebSocket connect) ──
        case 'voice_config':
            console.log('[Voice] Server config received:', data);
            if (data.sample_rate) pcmPlayer.sampleRate = data.sample_rate;
            if (data.script_buffer_size) pcmPlayer.scriptBufferSize = data.script_buffer_size;
            if (data.playback_min_buffer_ms !== undefined) pcmPlayer.minBufferMs = data.playback_min_buffer_ms;
            if (data.playback_empty_grace_ms !== undefined) pcmPlayer.emptyGraceMs = data.playback_empty_grace_ms;
            break;

        // ── Raw PCM audio chunks (local TTS, minimal latency) ──
        case 'audio_pcm':
            handlePcmChunk(data);
            break;
    }
}

// ===========================
// PCM Chunk Handlers
// ===========================

// Binary PCM handler — zero-copy Float32 from ArrayBuffer (no base64 decode)
function handleBinaryPcmChunk(f32) {
    const sr = pcmPlayer.sampleRate || 24000;
    if (!pcmPlayer.ctx) pcmPlayer.init(sr);

    state.pcmChunkCount++;
    const chunkAudioMs = (f32.length / sr * 1000).toFixed(0);

    // Track first PCM chunk timing
    if (!state.firstPcmReceived) {
        state.firstPcmReceived = true;
        if (state.lastVadEndTimestamp > 0) {
            const latency = Date.now() - state.lastVadEndTimestamp;
            addPerfEntry({
                event: 'first_pcm_received',
                label: '📨 Першы PCM чанк атрыманы',
                detail: `VAD→PCM: ${latency} мс | ${f32.length} samples (${chunkAudioMs} мс аўдыё) | binary`,
                elapsed_ms: latency,
                duration_ms: latency,
            });
        }
        state.firstAudioTimestamp = Date.now();
    }

    pcmPlayer.push(f32);

    // Log first few chunks with queue stats
    if (state.pcmChunkCount <= 5) {
        const stats = pcmPlayer.getStats();
        console.log(`[PCM Binary] #${state.pcmChunkCount}: ${f32.length} samples (${chunkAudioMs} ms) | ` +
            `queue=${stats.queueMs} ms (${stats.queueChunks} bufs) | playing=${pcmPlayer.playing}`);
    }
}

// Legacy base64 PCM handler (backward compatibility)
async function handlePcmChunk(data) {
    const sr = data.sr || 24000;
    if (!pcmPlayer.ctx) pcmPlayer.init(sr);
    const t0 = performance.now();
    let f32;
    try {
        const resp = await fetch(`data:application/octet-stream;base64,${data.data}`);
        const ab = await resp.arrayBuffer();
        f32 = new Float32Array(ab);
    } catch (_) {
        const bin = atob(data.data);
        const buf = new ArrayBuffer(bin.length);
        const u8 = new Uint8Array(buf);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        f32 = new Float32Array(buf);
    }
    handleBinaryPcmChunk(f32);
}

// ===========================
// Legacy Audio Playback (WAV blobs via BufferSource — for API mode / ADK artifacts)
// ===========================

function ensureAudioContext() {
    // Ensure loudspeaker route before creating/resuming AudioContext
    speakerphone.ensureActive();

    if (!state.audioContext) {
        const AC = window.AudioContext || window.webkitAudioContext;
        state.audioContext = new AC({ latencyHint: 'playback' });
    }
    if (state.audioContext.state === 'suspended') {
        state.audioContext.resume();
    }

    // Кароткі нямы гук для "прагрэву" дынаміка на iOS
    const oscillator = state.audioContext.createOscillator();
    const gainNode = state.audioContext.createGain();
    gainNode.gain.value = 0;
    oscillator.connect(gainNode);
    gainNode.connect(state.audioContext.destination);
    oscillator.start(0);
    oscillator.stop(0.001);
}

async function handleIncomingAudioChunk(blob) {
    ensureAudioContext();
    try {
        const arrayBuffer = await blob.arrayBuffer();
        const audioBuffer = await state.audioContext.decodeAudioData(arrayBuffer);
        scheduleAudioBuffer(audioBuffer);
    } catch (e) {
        console.error("Error decoding audio chunk:", e);
    }
}

/**
 * Convert a mono AudioBuffer to stereo (duplicate channel 0 → both L and R).
 * If already stereo+, returns as-is.
 */
function monoToStereo(monoBuffer, ctx) {
    if (monoBuffer.numberOfChannels >= 2) return monoBuffer;
    const stereo = ctx.createBuffer(2, monoBuffer.length, monoBuffer.sampleRate);
    const mono = monoBuffer.getChannelData(0);
    stereo.getChannelData(0).set(mono);
    stereo.getChannelData(1).set(mono);
    return stereo;
}

function scheduleAudioBuffer(buffer) {
    // Duplicate mono → stereo to force loudspeaker on mobile
    const stereoBuffer = monoToStereo(buffer, state.audioContext);
    const source = state.audioContext.createBufferSource();
    source.buffer = stereoBuffer;
    source.connect(state.audioContext.destination);

    const currentTime = state.audioContext.currentTime;
    if (!state.nextStartTime || state.nextStartTime < currentTime) {
        state.nextStartTime = currentTime + 0.02; // Reduced from 0.05
    }
    source.start(state.nextStartTime);

    if (!state.playbackLogSent && state.lastVadEndTimestamp > 0) {
        const playbackLatency = Date.now() - state.lastVadEndTimestamp;
        addPerfEntry({
            event: 'audio_playback_start',
            label: '▶️ Пачалося прайграванне (WAV)',
            detail: `Затрымка (VAD → гук): ${playbackLatency} мс`,
            elapsed_ms: playbackLatency,
            duration_ms: playbackLatency,
        });
        state.playbackLogSent = true;
    }

    state.nextStartTime += stereoBuffer.duration;

    if (!state.scheduledSources) state.scheduledSources = [];
    state.scheduledSources.push(source);

    source.onended = () => {
        const index = state.scheduledSources.indexOf(source);
        if (index > -1) state.scheduledSources.splice(index, 1);
    };

    setSpeakingState(true);
    updateSpeakingTimeout();
}

function updateSpeakingTimeout() {
    if (state.speakingTimeout) clearTimeout(state.speakingTimeout);
    if (!state.audioContext) return;
    const timeRemaining = state.nextStartTime - state.audioContext.currentTime;
    if (timeRemaining > 0) {
        state.speakingTimeout = setTimeout(() => {
            setSpeakingState(false);
            state.nextStartTime = 0;
        }, timeRemaining * 1000 + 200);
    } else {
        setSpeakingState(false);
    }
}

function stopAllPlayback() {
    // Stop legacy BufferSource playback
    if (state.scheduledSources) {
        state.scheduledSources.forEach(source => {
            try { source.stop(); } catch (e) { /* ignore */ }
        });
        state.scheduledSources = [];
    }
    state.nextStartTime = 0;
    if (state.speakingTimeout) {
        clearTimeout(state.speakingTimeout);
        state.speakingTimeout = null;
    }

    // Stop PCM ScriptProcessor playback
    pcmPlayer.reset();

    setSpeakingState(false);
}

// ===========================
// VAD & Recording
// ===========================
async function initVAD() {
    if (state.vad) return;

    if (window.ort) {
        window.ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/";
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
                    // Encode WAV first (before starting latency timer)
                    const wavBuffer = encodeWAV(audio);

                    state.lastVadEndTimestamp = Date.now();
                    state.firstProcessingTimestamp = 0;
                    state.firstAudioTimestamp = 0;
                    state.playbackLogSent = false;
                    // Reset PCM tracking for new interaction
                    state.firstPcmReceived = false;
                    state.pcmChunkCount = 0;
                    pcmPlayer._firstSampleFired = false;
                    pcmPlayer._chunkCount = 0;
                    pcmPlayer._totalSamples = 0;

                    addPerfEntry({
                        event: 'user_message',
                        label: '🎙️ Паведамленне адпраўлена',
                        detail: `VAD завяршыў, аўдыё (${audio.length} samples) адпраўлена адразу`,
                        elapsed_ms: 0,
                        duration_ms: 0,
                        _isSessionStart: true,
                    });

                    // Send WAV + 8-byte end marker in ONE binary message (saves 1 RTT)
                    // Trailer: "END\0" (4 bytes) + uint32 LE client timestamp low bits (4 bytes)
                    const trailer = new ArrayBuffer(8);
                    const tv = new DataView(trailer);
                    tv.setUint8(0, 0x45); // 'E'
                    tv.setUint8(1, 0x4E); // 'N'
                    tv.setUint8(2, 0x44); // 'D'
                    tv.setUint8(3, 0x00); // '\0'
                    tv.setUint32(4, state.lastVadEndTimestamp & 0xFFFFFFFF, true);
                    const combined = new Uint8Array(wavBuffer.byteLength + 8);
                    combined.set(new Uint8Array(wavBuffer), 0);
                    combined.set(new Uint8Array(trailer), wavBuffer.byteLength);
                    state.websocket.send(combined.buffer);
                }
            },
            onFrameProcessed: (probs) => {
                updateVisualizerFromVAD(probs.isSpeech);
            },
            positiveSpeechThreshold: 0.85,
            negativeSpeechThreshold: 0.4,
            redemptionFrames: 8,
            minSpeechFrames: 5,
        });
    } catch (e) {
        console.error("Failed to init VAD", e);
        updateStatus("Памылка ініцыялізацыі VAD: " + e.message);
        throw e;  // Re-throw so startSession can handle it
    }
}

function handleInterruption() {
    stopAllPlayback();
    if (state.websocket && state.websocket.readyState === WebSocket.OPEN) {
        state.websocket.send(JSON.stringify({ type: 'interrupt' }));
    }
}

function updateVisualizerFromVAD(isSpeech) {
    const bars = elements.visualizer.querySelectorAll('.visualizer-bar');
    if (!bars.length) return;
    bars.forEach(bar => {
        // Хваля бегае толькі калі Юзік гаворыць АБО калі карыстальнік рэальна пачаў гаворку (VAD пацвердзіў)
        const active = state.isSpeaking || (state.isRecording && !state.isProcessing && state.isStreaming);

        if (active) {
            const height = 30 + Math.random() * 70;
            bar.style.height = height + '%';
        } else {
            bar.style.height = '20%';
        }
    });

    // Паказваем візуальнае адрозненне цішыны ці гаворкі з VAD
    // Выкарыстоўваем state.isStreaming для стабільнасці (гэта цэлы фрагмент гаворкі, а не адзін фрэйм)
    if (state.isRecording && !state.isProcessing && !state.isSpeaking) {
        if (state.isStreaming) {
            if (!elements.micBtn.classList.contains('speech-active')) {
                elements.micBtn.classList.add('speech-active');
                updateStatus('🟢 Гаворка зафіксавана...');
            }
        } else {
            if (elements.micBtn.classList.contains('speech-active')) {
                elements.micBtn.classList.remove('speech-active');
                updateStatus('Слухаю...');
            }
        }
    }
}

// Helper to encode raw PCM to WAV
function encodeWAV(samples) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true);
    view.setUint32(28, 16000 * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
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
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            const isSecure = window.isSecureContext;
            const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
            if (!isSecure && !isLocalhost) {
                updateStatus("⚠️ Патрэбна HTTPS або localhost для доступу да мікрафона");
                return;
            }
            updateStatus("⚠️ Браўзер не падтрымлівае доступ да мікрафона");
            return;
        }

        // Force loudspeaker on mobile BEFORE any AudioContext creation
        // (must be inside user gesture — startSession is called from click handler)
        await speakerphone.activate();

        await initVAD();

        if (!state.vad) {
            updateStatus("⚠️ VAD не ініцыялізаваны. Немагчыма пачаць.");
            return;
        }

        // VAD handles its own mic capture — no need for separate ScriptProcessor streaming.
        // Audio is sent as complete WAV in onSpeechEnd directly from VAD's audio buffer.

        // Pre-initialize pcmPlayer so it's ready when first chunk arrives
        pcmPlayer.init(24000);

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
    // Stop all audio playback immediately
    stopAllPlayback();

    // Stop VAD (whether active or paused)
    if (state.vad) {
        try { await state.vad.pause(); } catch (_) {}
    }

    // Reset all state flags
    state.isRecording = false;
    state.isProcessing = false;
    state.isSpeaking = false;
    state.isStreaming = false;
    state._vadPaused = false;

    // Restore audio session to default
    audioSessionHelper.setAuto();

    setListeningState(false);
    updateStatus('Націсніце на мікрафон для пачатку');
}

function setListeningState(listening) {
    elements.micBtn.className = `mic-container ${listening ? 'listening' : ''}`;
    elements.visualizer.className = `audio-visualizer ${listening ? 'listening' : ''}`;
    elements.startBtn.disabled = listening;
    // Stop button should be enabled whenever the session is active
    // (listening, processing, OR speaking)
    const sessionActive = listening || state.isProcessing || state.isSpeaking;
    elements.stopBtn.disabled = !sessionActive;
    if (listening) {
        elements.startBtn.classList.add('recording');
        elements.startBtn.innerHTML = '● Працуе...';
        elements.statusText.classList.add('active');
    } else {
        elements.startBtn.classList.remove('recording');
        elements.startBtn.innerHTML = '▶ Пачаць';
        elements.statusText.classList.remove('active');
        elements.visualizer.className = 'audio-visualizer';
    }
}

function setProcessingState(processing) {
    state.isProcessing = processing;
    if (processing) {
        // Pause VAD while processing/speaking to avoid echo-triggered false positives
        pauseVAD();
        audioSessionHelper.setPlayback();
        elements.stopBtn.disabled = false;  // keep Stop active
        elements.micBtn.className = 'mic-container processing';
        elements.visualizer.className = 'audio-visualizer processing';
        updateStatus('Думаю...');
    } else if (!state.isSpeaking) {
        if (state.isRecording) {
            resumeVAD();
            audioSessionHelper.setAuto();
            elements.micBtn.className = 'mic-container listening';
            elements.visualizer.className = 'audio-visualizer listening';
            updateStatus('Слухаю...');
        } else {
            elements.micBtn.className = 'mic-container';
            elements.visualizer.className = 'audio-visualizer';
        }
    }
}

function setSpeakingState(speaking) {
    state.isSpeaking = speaking;
    if (speaking) {
        state.isProcessing = false;
        // Pause VAD during bot playback (anti-echo + forces playback session)
        pauseVAD();
        audioSessionHelper.setPlayback();
        elements.stopBtn.disabled = false;  // keep Stop active
        elements.micBtn.className = 'mic-container speaking';
        elements.visualizer.className = 'audio-visualizer speaking';
        updateStatus('Юзік адказвае...');
        elements.statusText.classList.add('active');
    } else {
        elements.statusText.classList.remove('active');
        // Resume VAD after bot finishes speaking
        audioSessionHelper.setAuto();
        if (state.isRecording) {
            resumeVAD();
            elements.micBtn.className = 'mic-container listening';
            elements.visualizer.className = 'audio-visualizer listening';
            updateStatus('Слухаю...');
            elements.statusText.classList.add('active');
        } else {
            elements.micBtn.className = 'mic-container';
            elements.visualizer.className = 'audio-visualizer';
        }
    }
}

/** Pause VAD mic processing (if running) */
function pauseVAD() {
    if (state.vad && state.isRecording && !state._vadPaused) {
        state.vad.pause();
        state._vadPaused = true;
        console.log('[VAD] ⏸ Paused (bot responding)');
    }
}

/** Resume VAD mic processing (if it was paused by us) */
function resumeVAD() {
    if (state.vad && state.isRecording && state._vadPaused) {
        state.vad.start();
        state._vadPaused = false;
        console.log('[VAD] ▶ Resumed (bot done)');
    }
}

function updateStatus(text) {
    elements.statusText.textContent = text;
}

function updateTranscript(text, isResponse = false) {
    const prefix = isResponse ? 'Юзік: ' : '👤 ';
    elements.transcript.textContent = prefix + text;
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

    const empty = body.querySelector('.perf-empty');
    if (empty) empty.remove();

    if (data._isSessionStart || data.event === 'user_message') {
        const divider = document.createElement('div');
        divider.className = 'perf-session-divider';
        divider.innerHTML = `<span class="perf-session-label">Сесія • ${formatTime(null)}</span>`;
        body.appendChild(divider);
    }

    const entry = document.createElement('div');
    const isComplete = data.event === 'pipeline_complete' || data.event === 'llm_complete';
    entry.className = `perf-entry${isComplete ? ' perf-entry-summary' : ''}`;
    entry.setAttribute('data-event', data.event || '');

    const timeStr = formatTime(data.timestamp);
    const elapsedStr = data.elapsed_ms !== undefined && data.elapsed_ms > 0 ? formatMs(data.elapsed_ms) : '';
    const deltaStr = data.delta_ms !== undefined && data.delta_ms > 0 ? `Δ ${formatMs(data.delta_ms)}` : '';

    entry.innerHTML = `
        <div class="perf-entry-header">
            <span class="perf-entry-label">${data.label || data.event || 'Падзея'}</span>
            <span class="perf-entry-time">${timeStr}</span>
        </div>
        ${data.detail ? `<div class="perf-entry-detail">${data.detail}</div>` : ''}
        <div class="perf-entry-metrics">
            ${elapsedStr ? `<span class="perf-entry-elapsed">+${elapsedStr}</span>` : ''}
            ${deltaStr ? `<span class="perf-entry-delta">${deltaStr}</span>` : ''}
        </div>
    `;

    body.appendChild(entry);
    body.scrollTop = body.scrollHeight;
    perfLogCount++;

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
