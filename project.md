# VibeIt Project Plan

## Product Goal

VibeIt is an AI app builder where users describe what they want, and the system generates and updates React projects through OpenCode running in isolated Upstash Boxes.

## Final Tech Stack

### Core Application

- Frontend + API: Next.js (App Router) + React + TypeScript
- Styling/UI: Tailwind CSS + shadcn/ui
- Package manager: pnpm

### AI Execution Layer

- Sandbox runtime: Upstash Box (one box per active project session)
- Agent runtime: OpenCode only (preinstalled in each box)
- Preview URLs: Upstash Box Preview (`box.getPreviewUrl(port)`)
- Project type support: React projects only

### Data and Storage

- Primary relational database: Neon Postgres
- Authentication: BetterAuth
- Durable project files: Cloudflare R2 (source of truth)
- Optional high-speed cache/rate-limit layer: Upstash Redis
- Optional background jobs/retries/schedules: QStash / Upstash Workflow

### Reliability and Monitoring

- Error monitoring: Sentry
- Structured logs + performance metrics for:
  - box create time
  - restore time from R2
  - preview ready time

## Non-Negotiable Platform Decisions

- Use OpenCode only as the coding agent runtime.
- Use one active box per project session.
- Delete box when project is closed to reduce storage/compute cost.
- Persist project state to R2 and restore from R2 on reopen.
- Support only React projects (no Next.js project generation, no plain HTML/CSS/JS mode).

## User and System Flow

### 1) Create Project (first time)

1. User creates a new project in dashboard.
2. Backend creates project row in Neon.
3. Backend creates a new Upstash Box.
4. Since R2 has no files yet, bootstrap React template workspace.
5. Start dev server (fixed port, e.g. 5173).
6. Create preview URL via `box.getPreviewUrl(5173)`.
7. Save initial project files to R2.
8. Return editor + live preview to user.

### 2) Open Existing Project

1. User opens project.
2. Backend creates a fresh box.
3. Backend downloads project files from R2 into `/work`.
4. Run `pnpm install --frozen-lockfile`.
5. Start dev server and create preview URL.
6. Return live session to user.

### 3) Prompt Run

1. User sends prompt.
2. Backend forwards prompt to OpenCode in project box.
3. OpenCode uses tools for file create/read/update/delete and commands.
4. If needed, OpenCode installs dependencies in-box.
5. Backend checkpoints changed files to R2.
6. UI receives stream events and updates files/preview/logs.

### 4) Close Project

1. User closes project.
2. Backend performs final sync to R2.
3. Backend deletes preview URL and box.
4. Neon project status is updated to inactive.

### 5) Reopen Project

1. New box is created.
2. Files are restored from R2.
3. App boots again and new preview URL is created.

## Dependency Installation Policy

- OpenCode can run `pnpm add` / `pnpm add -D` in-box.
- `package.json` and `pnpm-lock.yaml` must always be synced to R2 after install.
- On restore, always install from lockfile first (`--frozen-lockfile`).
- Optional: store dependency cache artifacts to reduce cold start time.

## Suggested Neon Postgres Schema

### ERD (high level)

- user (BetterAuth) -> projects (1:N)
- projects -> project_sessions (1:N)
- projects -> project_files (1:N metadata)
- projects -> agent_runs (1:N)
- user (BetterAuth) -> usage_events (1:N)

### SQL Draft

```sql
-- Extensions
create extension if not exists "pgcrypto";

-- Projects
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user"(id) on delete cascade,
  name text not null,
  description text,
  framework text not null default 'react-vite-ts',
  status text not null default 'inactive', -- inactive|active|error|archived
  r2_prefix text not null,
  last_opened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_user_id_idx on projects(user_id);
create index if not exists projects_status_idx on projects(status);

-- Active/previous box sessions for a project
create table if not exists project_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  upstash_box_id text,
  preview_url text,
  preview_port integer not null default 5173,
  session_status text not null default 'starting', -- starting|ready|closing|closed|error
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_sessions_project_id_idx on project_sessions(project_id);
create index if not exists project_sessions_box_id_idx on project_sessions(upstash_box_id);

-- File metadata only (actual file content stays in R2)
create table if not exists project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  path text not null,
  size_bytes bigint not null default 0,
  checksum text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, path)
);

create index if not exists project_files_project_id_idx on project_files(project_id);

-- Prompt executions / tool runs
create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  session_id uuid references project_sessions(id) on delete set null,
  prompt text not null,
  model text not null default 'opencode',
  status text not null default 'running', -- running|completed|failed|cancelled
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists agent_runs_project_id_idx on agent_runs(project_id);
create index if not exists agent_runs_session_id_idx on agent_runs(session_id);

-- Usage/billing telemetry
create table if not exists usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user"(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  session_id uuid references project_sessions(id) on delete set null,
  event_type text not null, -- box_created|box_deleted|prompt_run|r2_sync|preview_created
  quantity numeric(18,6) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists usage_events_user_id_idx on usage_events(user_id);
create index if not exists usage_events_project_id_idx on usage_events(project_id);
create index if not exists usage_events_event_type_idx on usage_events(event_type);
```

## API Surface (Recommended)

- `POST /api/projects` - create project + bootstrap box/workspace
- `POST /api/projects/:id/open` - create box + restore from R2 + preview
- `POST /api/projects/:id/prompt` - send prompt to OpenCode and stream output
- `POST /api/projects/:id/sync` - checkpoint file changes to R2
- `POST /api/projects/:id/close` - final sync + delete box
- `GET /api/projects/:id/preview` - fetch current preview URL/status

## Phase Plan

### Phase 1 (must-have)

- Neon + BetterAuth + Upstash Box + OpenCode + R2
- Core lifecycle (create/open/prompt/sync/close)
- Basic logs and error handling

### Phase 2 (stability and scale)

- Add Redis for strict rate limiting and ephemeral locks
- Add QStash/Workflow for robust background retries and scheduled cleanup
- Add Sentry and metrics dashboards
