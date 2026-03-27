# Yuzik Mobile

Bare Expo Router workspace for the mobile client.

## Requirements

- Node `22.17.0`
- npm `10.9.2`

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in the backend, Supabase, scheme, and package identifier values.
3. Set distinct values for `APP_DEV_PACKAGE_ID`, `APP_PREVIEW_PACKAGE_ID`, and `APP_PROD_PACKAGE_ID` so preview installs do not overwrite development or production builds.
4. Install dependencies with `npm install`.

## Scripts

- `npm test`
- `npm start`
- `npm run android`
- `npm run ios`

## Structure

- `app/` contains the Expo Router shell.
- `app/(tabs)` owns the current chat and settings tabs.
- Future routes such as `app/voice.tsx` can live outside `(tabs)` and will mount on the root stack automatically.
- `src/lib/env.ts` parses public runtime env state and app variants.
- `src/components/settings/DebugInfo.tsx` renders non-secret build and environment diagnostics.

## Verification

Run the targeted Task 2 verification:

```bash
npm test -- src/lib/env.test.ts src/components/settings/DebugInfo.test.tsx
```
