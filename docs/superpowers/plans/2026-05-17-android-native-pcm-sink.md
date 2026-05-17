# Android Native PCM Sink Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream Android mobile voice PCM frames directly through native `AudioTrack` instead of wrapping them into WAV chunks for `expo-av`.

**Architecture:** Add a focused Android React Native module named `NativePcmPlayer` and register it manually in the existing Expo Android app. Add a small TypeScript wrapper around `NativeModules`, then update `audio-playback.ts` so only local `PCM\0` frames use native streaming while WAV/MP3 bytes remain on the current `expo-av` queue.

**Tech Stack:** React Native 0.81, Expo SDK 54, Kotlin Android native module, Android `AudioTrack`, Jest, TypeScript.

---

## Chunk 1: JavaScript Native PCM Boundary

### Task 1: Add JS Wrapper and Routing Tests

**Files:**
- Create: `mobile/src/lib/native-pcm-player.ts`
- Modify: `mobile/src/lib/audio-playback.ts`
- Modify: `mobile/src/lib/audio-playback.test.ts`

- [ ] **Step 1: Write failing tests for native PCM routing**

Add tests to `mobile/src/lib/audio-playback.test.ts` that inject a native PCM sink into `createVoicePlaybackAdapter()`:

```ts
it("streams local PCM frames through native playback when available", async () => {
  const nativePcm = {
    isAvailable: jest.fn(() => true),
    pushFloat32Pcm: jest.fn().mockResolvedValue(undefined),
    reset: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
  };
  const writeBytesToCache = jest.fn();
  const playback = createVoicePlaybackAdapter({ nativePcm, writeBytesToCache });

  await playback.playBytes(createLocalPcmFrame([0.1, 0.2]), { sampleRate: 24000 });

  expect(nativePcm.pushFloat32Pcm).toHaveBeenCalledWith(expect.any(Uint8Array), 24000);
  expect(writeBytesToCache).not.toHaveBeenCalled();
});
```

Also add coverage that a rejected native push disables native playback and falls back to the existing WAV path.

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
cd mobile
npm test -- --runTestsByPath src/lib/audio-playback.test.ts
```

Expected: FAIL because `nativePcm` is not a supported adapter option yet.

- [ ] **Step 3: Create `native-pcm-player.ts` wrapper**

Implement a small wrapper:

```ts
import { NativeModules, Platform } from "react-native";

export type NativePcmPlayer = {
  isAvailable: () => boolean;
  pushFloat32Pcm: (bytes: Uint8Array, sampleRate: number) => Promise<void>;
  reset: () => Promise<void>;
  stop: () => Promise<void>;
};
```

Use `Platform.OS === "android"` and `NativeModules.NativePcmPlayer` to decide availability. Convert `Uint8Array` to a plain number array only if the bridge requires it.

- [ ] **Step 4: Update `audio-playback.ts` to prefer native PCM**

Extend `VoicePlaybackOptions` with `nativePcm?: NativePcmPlayer | null`. For `PCM\0` frames:

1. Strip the 8-byte frame header.
2. If native PCM is enabled and available, call `pushFloat32Pcm(pcmBytes, sampleRate)`.
3. On native failure, disable the native route and push the same frame through existing `bufferLocalPcmFrame()`.

Keep the existing WAV fallback code intact.

- [ ] **Step 5: Run focused tests**

Run:

```bash
cd mobile
npm test -- --runTestsByPath src/lib/audio-playback.test.ts
```

Expected: PASS.

## Chunk 2: Android Native AudioTrack Module

### Task 2: Implement and Register Android Module

**Files:**
- Create: `mobile/android/app/src/main/java/com/yuzik/mobile/dev/NativePcmPlayerModule.kt`
- Create: `mobile/android/app/src/main/java/com/yuzik/mobile/dev/NativePcmPlayerPackage.kt`
- Modify: `mobile/android/app/src/main/java/com/yuzik/mobile/dev/MainApplication.kt`

- [ ] **Step 1: Implement native module skeleton**

Create `NativePcmPlayerModule` extending `ReactContextBaseJavaModule` with methods:

```kotlin
@ReactMethod
fun pushFloat32Pcm(samples: ReadableArray, sampleRate: Int, promise: Promise)

@ReactMethod
fun reset(promise: Promise)

@ReactMethod
fun stop(promise: Promise)
```

Use a single-thread executor for writes.

- [ ] **Step 2: Implement `AudioTrack` stream ownership**

Create or recreate the track when sample rate changes. Use:

```kotlin
AudioAttributes.Builder()
  .setUsage(AudioAttributes.USAGE_MEDIA)
  .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)

AudioFormat.Builder()
  .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
  .setSampleRate(sampleRate)
  .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
```

Write float samples with `audioTrack.write(floatArray, 0, floatArray.size, AudioTrack.WRITE_BLOCKING)`.

- [ ] **Step 3: Register package manually**

Create `NativePcmPlayerPackage` and add it in `MainApplication.kt`:

```kotlin
PackageList(this).packages.apply {
  add(NativePcmPlayerPackage())
}
```

- [ ] **Step 4: Compile Android debug sources**

Run:

```bash
cd mobile/android
./gradlew.bat :app:compileDebugKotlin
```

Expected: BUILD SUCCESSFUL.

## Chunk 3: Verification and Fallback Safety

### Task 3: Run Project Checks

**Files:**
- Modify only if checks expose issues in files above.

- [ ] **Step 1: Run TypeScript/Jest playback checks**

Run:

```bash
cd mobile
npm test -- --runTestsByPath src/lib/audio-playback.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run broader mobile tests if focused tests pass**

Run:

```bash
cd mobile
npm test
```

Expected: PASS, or document unrelated pre-existing failures with exact test names.

- [ ] **Step 3: Inspect final diff**

Run:

```bash
git diff -- mobile/src/lib/native-pcm-player.ts mobile/src/lib/audio-playback.ts mobile/src/lib/audio-playback.test.ts mobile/android/app/src/main/java/com/yuzik/mobile/dev/NativePcmPlayerModule.kt mobile/android/app/src/main/java/com/yuzik/mobile/dev/NativePcmPlayerPackage.kt mobile/android/app/src/main/java/com/yuzik/mobile/dev/MainApplication.kt
```

Expected: Diff only includes the Android native PCM sink, JS wrapper, playback routing, and tests.
