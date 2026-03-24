# Environment Variable Management Implementation

## What was added

- Encrypted project env var storage in Neon via `project_env_vars`
- AES-256-GCM helpers in `src/lib/project-env.ts`
- GET/POST API at `src/app/api/projects/[projectId]/env/route.ts`
- Box env injection through `.env.local` writing and preview restart hooks
- Project Settings UI with an Environment editor in `src/app/projects/[projectId]/page.tsx`
- Hidden/excluded `.env*` handling in file listing and R2 sync paths
- Generated Drizzle migration output in `drizzle/`

## Storage model

- Each env var is stored per project row in `project_env_vars`
- Value is never stored plaintext in DB
- Stored fields:
  - `key`
  - `encrypted_value`
  - `iv`
  - `auth_tag`

## Runtime injection flow

1. Read encrypted env vars for the project
2. Decrypt on the server using `ENV_ENCRYPTION_KEY`
3. Build an env map
4. Write `.env.local` into the Upstash box workspace
5. Restart the preview/dev server so Vite/Next picks up new values

## UI behavior

- Added a `Settings` tab beside Preview and Files
- Added `Environment` as the first settings section
- Supports add/remove/edit/save
- Values are masked by default and can be revealed
- Saving triggers backend persistence and preview restart when an active box exists

## Safety rules implemented

- `.env*` files are hidden from the workspace file explorer
- `.env*` files are excluded from R2 sync
- No fallback secrets are hardcoded in code
- Restart errors are returned to UI without exposing secret values

## Validation completed

- IDE diagnostics: clean on touched TypeScript files
- `pnpm exec eslint` on touched files: passed
- `pnpm exec tsc --noEmit`: passed
- `pnpm db:generate`: generated migration output successfully

## Notes

- This repo had no existing `drizzle/` folder, so the generated migration is the initial schema migration, not only the env var table delta.
- `DATABASE_URL` was not set in the current shell, so migration generation used a temporary local-style value only for Drizzle codegen.
- Actual DB migration application was not run.