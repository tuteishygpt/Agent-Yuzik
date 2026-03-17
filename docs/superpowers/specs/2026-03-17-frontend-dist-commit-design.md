# Frontend Dist Commit Design

## Goal

Stop requiring a frontend build on the server after installation by committing `frontend/dist` into the repository, while keeping the current build commands available as a fallback when prebuilt assets are missing.

## Current Problem

The repository already contains a Vite frontend in `frontend/`, and `frontend/dist/` is generated locally, but `.gitignore` excludes it from version control. `install_universal.sh` therefore always installs Node dependencies and runs `npm run build` on the target server.

That creates unnecessary deployment work and an avoidable runtime dependency on a successful server-side Node build.

## Decision

Use committed Vite build artifacts as the default deployment path:

- remove `frontend/dist/` from `.gitignore`
- rebuild the frontend locally and commit the generated `frontend/dist` files
- update `install_universal.sh` to skip `npm install && npm run build` when `frontend/dist/index.html` already exists
- preserve the existing build commands as a fallback if the repository is checked out without built assets

## Scope

- Update Git ignore rules so `frontend/dist` can be tracked
- Rebuild the frontend with the existing `vite build` script
- Commit the generated static files under `frontend/dist`
- Change the installer to prefer committed assets and only build when they are absent

## Out Of Scope

- Changing frontend source behavior or Vite configuration
- Removing Node or npm from the installer entirely
- Reworking deployment beyond this fallback check

## Risks And Mitigation

- Committed build output can drift from `frontend/src`
  - Mitigation: rebuild `frontend/dist` in the same change set as any frontend source edit
- Repository size increases because generated assets are tracked
  - Mitigation: scope tracking only to `frontend/dist`, not other generated folders
- A checkout without `dist` must still install cleanly
  - Mitigation: installer keeps the existing build path as a fallback

## Validation

- Run `npm run build` in `frontend/` and confirm the build succeeds
- Inspect `git status` to confirm `frontend/dist` is trackable after the ignore-rule change
- Run a shell check on `install_universal.sh` logic by verifying the fallback branch and the skip branch text
