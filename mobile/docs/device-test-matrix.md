# Device Test Matrix

Date opened: 2026-03-27
Branch: `codex/mobile-v1-baseline`

## Status Legend

- `PASS`: verified on physical hardware
- `FAIL`: reproduced issue on physical hardware
- `PENDING`: not yet executed

## iPhone

Device: PENDING
iOS version: PENDING
Build/profile: PENDING

| Check | Status | Notes |
| --- | --- | --- |
| Clean install | PENDING | |
| Anonymous bootstrap | PENDING | |
| Guest to email link and callback return | PENDING | |
| Text chat | PENDING | |
| Image upload | PENDING | |
| PDF upload | PENDING | |
| TXT upload | PENDING | |
| Audio upload | PENDING | |
| Teacher lesson selection | PENDING | |
| Push-to-talk recording | PENDING | |
| Transcript visibility | PENDING | |
| Assistant audio playback through speaker | PENDING | |
| Interrupt under one second | PENDING | |
| App kill and reopen session continuity | PENDING | |
| Reconnect after manual network drop | PENDING | |

## Android

Device: PENDING
Android version: PENDING
Build/profile: PENDING

| Check | Status | Notes |
| --- | --- | --- |
| Clean install | PENDING | |
| Anonymous bootstrap | PENDING | |
| Guest to email link and callback return | PENDING | |
| Text chat | PENDING | |
| Image upload | PENDING | |
| PDF upload | PENDING | |
| TXT upload | PENDING | |
| Audio upload | PENDING | |
| Teacher lesson selection | PENDING | |
| Push-to-talk recording | PENDING | |
| Transcript visibility | PENDING | |
| Assistant audio playback through speaker | PENDING | |
| Interrupt under one second | PENDING | |
| App kill and reopen session continuity | PENDING | |
| Reconnect after manual network drop | PENDING | |

## Automated Evidence Already Available

- `npm test` passed in `mobile/`
- `npx tsc --noEmit` passed in `mobile/`
- backend auth/chat/voice/history/teacher/artifact regression suite passed in repo root

These automated results reduce risk but do not replace the physical iPhone and Android checks above.
