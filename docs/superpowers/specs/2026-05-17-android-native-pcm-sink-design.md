# Android Native PCM Sink Design

## Goal

Make mobile voice playback behave like the web PCM path for Android by streaming backend Float32 PCM frames directly into a native audio sink. The current mobile path buffers `PCM\0` frames, wraps them as WAV, and plays them through `expo-av`, which adds avoidable latency and chunk-boundary artifacts.

## Scope

- Add an Android native module backed by `AudioTrack` in `MODE_STREAM`.
- Add a small JS API with `pushFloat32Pcm(bytes, sampleRate)`, `reset()`, and `stop()`.
- Route local PCM websocket frames through the native sink when available.
- Keep WAV/MP3 playback on the existing `expo-av` path.
- Keep iOS/web on an explicit fallback/stub path until an iOS native project exists.

## Non-Goals

- Do not change the backend websocket protocol.
- Do not change recording, VAD, transcription, teacher mode, or chat playback.
- Do not implement iOS native playback in this pass.
- Do not replace `expo-av` for non-PCM response audio.

## Architecture

Android will expose `NativePcmPlayer` from the existing React Native app package. Internally it owns one mono `AudioTrack` configured for float PCM and stream mode. On first push, or when the sample rate changes, it creates a track with a buffer at least as large as Android's minimum buffer size. Writes happen on a single background executor so JS calls do not block the UI thread.

The JS wrapper, `native-pcm-player.ts`, reads `NativeModules.NativePcmPlayer` and exposes a typed wrapper. If the module is absent or any call fails, callers can permanently disable native PCM for the session and use the current WAV fallback.

`audio-playback.ts` remains the main playback adapter boundary. For local PCM frames it will strip the 8-byte `PCM\0` frame header and call `pushFloat32Pcm(rawPcmBytes, sampleRate)`. If native streaming is unavailable or fails, the existing buffered WAV path remains the fallback. Non-PCM bytes continue through `expo-av`.

## Data Flow

1. Backend sends binary frame: `PCM\0` magic, uint32 sample count, Float32 PCM bytes.
2. `voice-socket.ts` emits `{ type: "audio", bytes }`.
3. `useVoiceSession.ts` calls `playBytes(bytes, { sampleRate })`.
4. `audio-playback.ts` identifies the frame as local PCM.
5. Native path: strip header, push bytes to Android `AudioTrack`.
6. Fallback path: buffer PCM chunks, wrap as WAV, enqueue through `expo-av`.

## Error Handling

If native module lookup fails, native PCM is treated as unavailable from startup. If `pushFloat32Pcm`, `reset`, or `stop` rejects, playback falls back to the existing WAV path for future chunks and does not crash the voice session. `stop()` and `release()` call the native stop/reset hooks best-effort and still clear JS fallback state.

## Testing

Unit tests cover JS routing:

- PCM frames use `pushFloat32Pcm` when the native sink is available.
- PCM frames fall back to buffered WAV playback when the native sink is unavailable.
- A rejected native push disables the native route and falls back.
- `stop()` and `release()` call the native stop/reset hooks and clear pending fallback buffers.

Android native behavior should be smoke-tested with `expo run:android` or an emulator/device because Jest cannot validate actual `AudioTrack` playback.
