# VibeIt Database Schema

## Stack

- Database: Neon Postgres
- Driver: `pg`
- ORM: Drizzle
- Auth: Better Auth

## Tables

### Better Auth tables

- `user`
  - `id`
  - `name`
  - `email`
  - `email_verified`
  - `image`
  - `created_at`
  - `updated_at`

- `session`
  - `id`
  - `expires_at`
  - `token`
  - `created_at`
  - `updated_at`
  - `ip_address`
  - `user_agent`
  - `user_id`

- `account`
  - `id`
  - `account_id`
  - `provider_id`
  - `user_id`
  - `access_token`
  - `refresh_token`
  - `id_token`
  - `access_token_expires_at`
  - `refresh_token_expires_at`
  - `scope`
  - `password`
  - `created_at`
  - `updated_at`

- `verification`
  - `id`
  - `identifier`
  - `value`
  - `expires_at`
  - `created_at`
  - `updated_at`

### App tables

- `projects`
  - `id`
  - `user_id` (FK to Better Auth `user.id`)
  - `name`
  - `description`
  - `framework` (fixed: `react-vite-ts`)
  - `status` (`inactive | active | closing | error | archived`)
  - `r2_prefix`
  - `thumbnail_url`
  - `thumbnail_updated_at`
  - `last_opened_at`
  - `created_at`
  - `updated_at`

- `project_sessions`
  - `id`
  - `project_id`
  - `upstash_box_id`
  - `preview_url`
  - `preview_port`
  - `session_status` (`starting | ready | closing | closed | error`)
  - `started_at`
  - `ended_at`
  - `created_at`
  - `updated_at`

- `agent_runs`
  - `id`
  - `project_id`
  - `session_id`
  - `prompt`
  - `model` (fixed: `opencode`)
  - `status` (`running | completed | failed | cancelled`)
  - `started_at`
  - `completed_at`
  - `error_message`
  - `created_at`

- `project_files`
  - `id`
  - `project_id`
  - `path`
  - `size_bytes`
  - `checksum`
  - `last_synced_at`
  - `created_at`
  - `updated_at`

- `usage_events`
  - `id`
  - `user_id` (FK to Better Auth `user.id`)
  - `project_id`
  - `session_id`
  - `event_type`
  - `quantity`
  - `metadata`
  - `created_at`

## Close Project Flow

1. Set project/session to `closing`.
2. Capture thumbnail from live preview URL.
3. Save thumbnail to project folder in R2.
4. Sync changed files to R2.
5. Delete Upstash box.
6. Set session `closed` and project `inactive`.
