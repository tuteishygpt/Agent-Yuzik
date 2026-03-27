# Voice Spike Results

## Scope

This document records the current mobile voice baseline work on the `codex/mobile-v1-baseline` branch.

## Automated Evidence

- `npm test -- src/lib/voice-socket.test.ts src/features/voice/useVoiceSession.test.tsx`
- `npm test`
- `npx tsc --noEmit`
- `npx expo config --type public`

All automated checks above passed in this worktree after the voice and Expo config fixes landed.

## What Was Verified

- Voice socket auth is sent before binary audio.
- Outgoing audio is framed as `WAV + END\0 + uint32 timestamp`.
- Incoming voice control messages update session state.
- Teacher-mode socket events are wired into the mobile voice session.
- Interrupt stops playback immediately and sends the protocol interrupt message.
- Reconnect preserves transcript state and marks the session as retry-required when resumption is incomplete.

## What Is Still Pending

- Physical iPhone voice spike.
- Physical Android voice spike.
- On-device confirmation of speaker playback, interrupt latency, and reconnect behavior under a real network drop.

## Notes

The web spike and the backend voice contracts are the reference. The remaining work is device validation, not protocol discovery.
