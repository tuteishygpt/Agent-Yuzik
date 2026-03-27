# Release Readiness

## Summary

The mobile baseline is code-complete and automated verification is green in this worktree.

## Automated Checks

- `npm test` passes.
- `npx tsc --noEmit` passes.
- `npx expo config --type public` passes after the Expo config hotfix.

## Release Criteria

- Physical iPhone voice spike recorded.
- Physical Android voice spike recorded.
- Guest to email link flow recorded on a device.
- Chat upload paths exercised on-device for image, PDF, TXT, and audio.
- Teacher lesson selection exercised on-device.
- Reconnect and interrupt behavior exercised on-device.

## Privacy And Deep Links

- The app uses explicit scheme-based deep linking for auth callback return.
- The auth callback route is `auth/callback`.
- The branch should keep the callback flow and deep-link scheme aligned with the deployed backend environment.

## Known Blockers

- Physical iPhone verification is not yet documented.
- Physical Android verification is not yet documented.
- Store-specific metadata, screenshots, and privacy review artifacts are not yet prepared.

## Current Verdict

Not release-ready yet. The code path is ready for device validation, but release sign-off remains blocked on the manual device matrix.
