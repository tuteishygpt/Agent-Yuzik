# Yuzik Mobile

Bare Expo Router workspace for the mobile client.

## Requirements

- Node `22.17.0`
- npm `10.9.2`
- A configured mobile `.env` file based on `.env.example`

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in the backend, Supabase, scheme, and package identifier values.
3. Set distinct values for `APP_DEV_PACKAGE_ID`, `APP_PREVIEW_PACKAGE_ID`, and `APP_PROD_PACKAGE_ID` so preview installs do not overwrite development or production builds.
4. Install dependencies with `npm install`.
5. Validate the Expo config with `npx expo config --type public`.

## Scripts

- `npm test`
- `npx tsc --noEmit`
- `npm start`
- `npm run android`
- `npm run ios`
- `npx expo config --type public`

## Structure

- `app/` contains the Expo Router shell.
- `app/(tabs)` owns the current chat and settings tabs.
- Future routes such as `app/voice.tsx` can live outside `(tabs)` and will mount on the root stack automatically.
- `src/lib/env.ts` parses public runtime env state and app variants.
- `src/components/settings/DebugInfo.tsx` renders non-secret build and environment diagnostics.
- `src/features/chat/` owns the authenticated chat, upload, and protected artifact flows.
- `src/features/teacher/` owns lesson catalog loading and teacher-mode state.
- `src/features/voice/` owns push-to-talk voice state, transcript playback, and reconnect handling.

## Build Profiles

- `development` is for local device debugging.
- `preview` is the internal install target for shared QA and smoke tests.
- `production` is the store-targeted release profile.

## Verification

Run the automated checks that currently define the mobile baseline:

```bash
npm test
npx tsc --noEmit
```

Run the Expo config sanity check if environment values change:

```bash
npx expo config --type public
```

## Readiness

The branch is code-complete for the mobile baseline, but release readiness is still blocked on physical iPhone and Android verification.
