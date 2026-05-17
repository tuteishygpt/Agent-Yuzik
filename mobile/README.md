# Yuzik Mobile

Expo Router workspace for the mobile v1 client.

## Requirements

- Node `22.17.0`
- npm `10.9.2`

## Environment Setup

1. Copy `.env.example` to `.env`.
2. Populate these required values:
   - `EXPO_PUBLIC_BACKEND_URL`
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - `EXPO_PUBLIC_DEV_SCHEME`
   - `EXPO_PUBLIC_PROD_SCHEME`
   - `EXPO_PUBLIC_BUILD_CHANNEL`
   - `APP_DEV_PACKAGE_ID`
   - `APP_PREVIEW_PACKAGE_ID`
   - `APP_PROD_PACKAGE_ID`
3. Use distinct package identifiers for dev, preview, and production installs.

Current mobile Supabase project:

- Project name: `yuzik-mobile`
- Project ref: `doszqckatytesciwlwzv`
- Project URL: `https://doszqckatytesciwlwzv.supabase.co`
- Backend URL: `https://yuzik.tuteishygpt.pro`

Supabase Auth URL configuration still needs these dashboard entries:

- Enable Anonymous Sign-Ins under Auth providers. The mobile shell bootstraps with `signInAnonymously()` before linking an email account.
- Site URL: `https://yuzik.tuteishygpt.pro`
- Additional Redirect URLs: `yuzik-dev://auth/callback`, `yuzik://auth/callback`

## Install

```bash
npm install
```

## Expo CLI Sanity Check

The Expo config is expected to resolve directly from the CLI.

```bash
npx expo config --type public
```

## Scripts

- `npm start`
- `npm run ios`
- `npm run android`
- `npm run web`
- `npm test`

## App Areas

- `app/(tabs)/chat.tsx`: authenticated chat, uploads, protected artifact handling
- `app/(tabs)/settings.tsx`: runtime/build diagnostics
- `app/auth/callback.tsx`: Supabase PKCE callback flow
- `app/voice.tsx`: push-to-talk voice baseline with reconnect and teacher controls

## Verification

### Mobile

```bash
npm test
npx tsc --noEmit
npx expo config --type public
```

### Backend contracts used by mobile

Run from repo root:

```bash
python -m pytest tests/test_supabase_auth.py tests/test_voice_ws_auth.py tests/test_chat_persistence.py tests/test_voice_history_api.py tests/test_teacher_mode.py tests/test_artifact_storage.py -v
```

## Current Readiness

- Automated mobile suite: passing
- Automated backend regression suite used by mobile: passing
- Physical iPhone matrix: pending
- Physical Android matrix: pending

See:

- `mobile/docs/voice-spike-results.md`
- `mobile/docs/device-test-matrix.md`
- `mobile/docs/release-readiness.md`
