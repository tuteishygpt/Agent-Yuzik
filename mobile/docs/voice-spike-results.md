# Voice Spike Results

Date: 2026-03-27
Branch: `codex/mobile-v1-baseline`
Worktree: `D:/CodexPRJ/Yuzik/.worktrees/mobile-v1-baseline`

## Scope

This document captures the automated voice-spike evidence available in this branch before physical-device checks.

## Implemented Baseline

- Authenticated `/api/voice` WebSocket client with required first-message auth.
- Outgoing voice framing as `WAV + END\0 + uint32 timestamp`.
- Session hook for connect, reconnect, interrupt, transcript state, and teacher-mode events.
- Native recording and playback adapters wired through `expo-audio`.
- Voice route at `mobile/app/voice.tsx` with transcript panel, controls, and teacher integration.

## Automated Verification

### Mobile voice tests

Command:

```bash
npm test -- src/lib/voice-socket.test.ts src/features/voice/useVoiceSession.test.tsx
```

Result: PASS

Coverage captured by the focused suite:

- first-message auth is sent before any binary audio frame
- outgoing audio uses the expected `WAV + END\0 + uint32 timestamp` trailer
- inbound `voice_config`, `processing`, `transcription`, `response`, `teacher_mode_started`, `teacher_mode_stopped`, `error`, and `interruption_handshake` messages update session state
- reconnect preserves transcript and teacher selection state and surfaces `reconnected, please retry`
- interrupt stops playback and sends the protocol interrupt message

### TypeScript

Command:

```bash
npx tsc --noEmit
```

Result: PASS

### Full mobile suite

Command:

```bash
npm test
```

Result: PASS (`11` suites, `50` tests)

## Known Gaps Before Device Validation

- No physical iPhone run has been recorded yet.
- No physical Android run has been recorded yet.
- The current automated suite does not prove end-to-end speaker playback quality on device hardware.
- The current automated suite does not prove microphone permissions and recording format behavior on physical devices.

## Current Assessment

Code-complete for automated voice baseline work.

Release-readiness for voice remains blocked on the physical-device matrix recorded in:

- `mobile/docs/device-test-matrix.md`
- `mobile/docs/release-readiness.md`
