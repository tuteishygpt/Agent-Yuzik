# Supabase Ops Checklist

## Auth Setup

- Enable anonymous sign-ins in Supabase Auth.
- Add web callback URLs for local and production web environments:
  - `SUPABASE_WEB_CALLBACK_DEV`
  - `SUPABASE_WEB_CALLBACK_PROD`
- Reserve and document mobile callback URLs for local and production mobile environments:
  - `SUPABASE_MOBILE_CALLBACK_DEV`
  - `SUPABASE_MOBILE_CALLBACK_PROD`
- Confirm provider placeholders exist for email, Google, and Apple. Do not block rollout on Google/Apple if only email linking is ready.

## Secrets And Environment

- Store these backend secrets in the deployment environment:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_JWT_ISSUER`
  - `SUPABASE_JWT_AUDIENCE`
  - `SUPABASE_UPLOAD_BUCKET`
  - `SUPABASE_ARTIFACT_BUCKET`
  - callback env vars for web and mobile
- Verify the service-role key is only present in backend/server-side environments.

## Database And Storage

- Apply `supabase/migrations/001_canonical_schema.sql`.
- Apply `supabase/migrations/002_rls_and_storage.sql`.
- Apply `supabase/migrations/003_mobile_contract_cleanup.sql`.
- If bucket creation is managed outside SQL in your project, manually create private buckets named `user-uploads` and `assistant-artifacts`.
- Verify RLS is enabled on all canonical tables and object policies scope access by `auth.uid()`.

## Verification

- Confirm anonymous users can authenticate and receive a valid Supabase session.
- Confirm authenticated users only see their own rows through RLS.
- Confirm storage object keys are written under a user-owned prefix, for example `<user-id>/...`.
- Confirm guest-to-email account linking keeps the same `auth.users.id`.
