# Release Readiness

Date: 2026-03-27
Branch: `codex/mobile-v1-baseline`

## Summary

Mobile v1 is code-complete for the baseline scope in this branch, but it is not release-ready yet.

## Automated Checks

- Mobile Jest suite: PASS
- Mobile TypeScript compile: PASS
- Backend auth/chat/voice/history/teacher/artifact regression suite: PASS
- Expo CLI config resolution: PASS via `npx expo config --type public` with required env vars populated

## Blocking Items

- Physical iPhone verification not yet recorded
- Physical Android verification not yet recorded
- Store/privacy review not yet completed
- Production deep-link and callback behavior not yet validated on device builds
- Final EAS credentials, identifiers, and signing ownership still need project-specific confirmation

## Privacy / Store / Legal Notes

- Guest and linked-account auth flows exist in code, but privacy disclosures for account creation, analytics, and uploaded content retention are still undocumented for store submission.
- Voice capture, transcript visibility, and uploaded media handling should be reviewed against App Store and Play Store privacy questionnaires before a production submission.
- No store metadata, age rating, or support URL work is captured in this branch yet.

## Deep Link Readiness

- Auth callback routes are implemented in the app shell.
- Expo config now resolves correctly from the CLI when required env vars are provided.
- Preview and production deep-link behavior still requires physical-device validation and signed-build confirmation.

## Build Readiness

- `expo-audio` is installed for the mobile voice baseline.
- `eas.json` defines `development`, `preview`, and `production` profiles.
- Preview and production profiles still need live project IDs, credentials, and a real device-build pass.

## Go / No-Go

Current status: NO-GO

Move to GO only after:

1. iPhone matrix is recorded as passing
2. Android matrix is recorded as passing
3. privacy/store blockers are resolved or explicitly accepted
4. signed preview/production builds are confirmed
