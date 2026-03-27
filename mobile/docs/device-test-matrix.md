# Device Test Matrix

## Status

All physical-device items below are still pending. No iPhone or Android hardware run has been recorded in this branch yet.

| Scenario | iPhone | Android | Notes |
| --- | --- | --- | --- |
| Clean install | Pending | Pending | Verify first launch and initial bootstrap. |
| Anonymous bootstrap | Pending | Pending | Confirm guest session creation and persistence. |
| Guest -> email link flow | Pending | Pending | Validate auth callback return and account linking. |
| Text chat | Pending | Pending | Confirm bearer auth, history hydration, and send. |
| Image upload | Pending | Pending | Confirm multipart upload and image artifact handling. |
| PDF upload | Pending | Pending | Confirm protected file open/share fallback. |
| TXT upload | Pending | Pending | Confirm protected file open/share fallback. |
| Audio upload | Pending | Pending | Confirm protected file playback path. |
| Teacher lesson selection | Pending | Pending | Confirm lesson catalog loading and state retention. |
| Push-to-talk recording | Pending | Pending | Confirm record/send flow and server auth. |
| Transcript visibility | Pending | Pending | Confirm transcript updates during voice turns. |
| Assistant audio playback | Pending | Pending | Confirm speaker playback and cache reuse. |
| Interrupt under one second | Pending | Pending | Measure stop latency while assistant audio is playing. |
| App kill/reopen continuity | Pending | Pending | Confirm session and state recovery. |
| Reconnect after manual network drop | Pending | Pending | Confirm retry state and preserved transcript. |

## Device Matrix Fields

- Device model
- OS version
- Build profile
- App version
- Backend environment
- Result
- Blockers

## Recording Rule

Do not mark any row as passed until the result has been observed on a physical device.
