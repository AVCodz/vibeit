# Ideas for VibeIt

## Idea 1: Environment Variable Management

### Problem
Users building projects that require API keys, database URLs, or other secrets (e.g. Stripe, Supabase, Firebase) have no way to inject them into the Upstash Box. Hardcoding secrets in source files means they'd leak into R2 and the DB.

### Proposed Solution
- **Storage**: New `project_env_vars` table in Neon. Values encrypted with AES-256 using a server-side `ENV_ENCRYPTION_KEY` (stored in VibeIt's own `.env`). Frontend never sees the raw encryption key.
- **Injection at box boot**: Decrypt env vars server-side and pass them via two mechanisms:
  1. `Box.create({ env: { ...decryptedUserEnvVars, VIBEIT_PROJECT_ID: projectId } })` — process-level env vars available to all commands.
  2. Write an ephemeral `.env` file into the workspace after R2 restore so Vite picks them up via `import.meta.env`.
- **Exclusion from R2 sync**: Add `.env*` to the R2 sync exclude list so plain-text secrets are never persisted to object storage. The `.env` file is regenerated from the encrypted DB values on every box boot.
- **UI**: Project settings panel with a key-value editor. Values masked by default, revealable on click. Add/edit/delete operations.
- **Security**: Redact env var values from terminal output and chat where possible. Never return raw values in API responses beyond the settings panel.

---

## Idea 2: Agent Skills Integration

### Problem
OpenCode (the agent running inside Upstash Box) can be extended with "Skills" — reusable instruction sets defined in `SKILL.md` files. Vercel and the community have published many useful skills (database integration, deployment, testing, etc.), but there's no mechanism in VibeIt to install them into a user's box.

### How OpenCode Skills Work
- OpenCode discovers skills from these project-local paths:
  - `.opencode/skills/<name>/SKILL.md`
  - `.claude/skills/<name>/SKILL.md`
  - `.agents/skills/<name>/SKILL.md`
- Each `SKILL.md` requires YAML frontmatter with `name` (lowercase, hyphenated) and `description`.
- Skills are loaded on-demand — the agent sees a list of available skills and calls `skill({ name: "..." })` to load the full content when needed.
- Permissions can be configured via `opencode.json` (allow/deny/ask per skill pattern).

### Core Insight
Skills are the **universal extension mechanism** — not just for databases. Any capability you want the agent to have (frontend patterns, backend integrations, deployment workflows), you teach it via a `SKILL.md`. Combined with Idea 1 (env vars), this becomes a full plugin system: the skill tells the agent *what to do*, the env var gives it *the credentials to do it*.

### Skill Categories

**Frontend Skills:**
- `tailwind-css` — Tailwind conventions, custom theme tokens, `cn()` utility usage
- `shadcn-ui` — Component library usage, available variants, import paths, composition patterns
- `react-router` — Routing patterns, layout conventions, nested routes
- `framer-motion` — Animation patterns, motion components, gesture handling
- `three-js` — 3D scene setup, React Three Fiber patterns, performance tips

**Backend / Integration Skills:**
- `neon-database` — Drizzle ORM, schema patterns, migration workflow + env var `DATABASE_URL`
- `supabase` — Auth, realtime subscriptions, storage APIs + env vars `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- `stripe` — Payment flows, checkout sessions, webhook handling + env var `STRIPE_SECRET_KEY`
- `firebase` — Firestore, auth, hosting + env vars `FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID`
- `resend` — Email sending, templates, domain verification + env var `RESEND_API_KEY`
- `uploadthing` — File upload handling + env var `UPLOADTHING_SECRET`

**Fullstack Skills:**
- `next-auth` / `better-auth` — Authentication setup with OAuth providers, session management
- `deploy-vercel` — Build config, env setup, deployment commands
- `api-design` — REST patterns, error handling conventions, input validation
- `trpc` — Type-safe API layer, router setup, React Query integration

### How Skills + Env Vars Work Together
Example flow for a user who wants a Supabase-backed app:
1. User enables the `supabase` skill in project settings.
2. User adds `SUPABASE_URL` and `SUPABASE_ANON_KEY` in the env vars panel (Idea 1).
3. On box boot, VibeIt:
   - Writes `.opencode/skills/supabase/SKILL.md` into the workspace.
   - Injects the env vars via `Box.create({ env })` and the ephemeral `.env` file.
4. User prompts: "Add user authentication with Google sign-in."
5. The agent loads the `supabase` skill, sees the env vars are available, and builds a working auth flow — no guessing, no hallucinated API patterns.

### Proposed Solution
- **Skill catalog**: Maintain a curated library of `SKILL.md` files in VibeIt's codebase (e.g. `src/skills/<name>/SKILL.md`). Each skill is a vetted, tested instruction set.
- **Installation at box boot**: During `bootstrapProjectBox()`, after R2 restore and before the dev server starts:
  1. Read the user's enabled skills from the DB (or a default set).
  2. Write each skill's `SKILL.md` into `.opencode/skills/<name>/SKILL.md` inside the workspace via `box.fs.write()`.
  3. Optionally write an `opencode.json` with permission config (all skills `allow` by default).
- **User-facing UI**: A "Skills" section in project settings where users can:
  - Browse available skills by category (Frontend / Backend / Fullstack).
  - Toggle skills on/off per project.
  - See which env vars a skill requires (linked to Idea 1).
  - Paste custom `SKILL.md` content for power users.
- **Default skills**: Every new project gets a base set of always-on skills (e.g. `tailwind-css`, `shadcn-ui`) that match the React template.

### Open Questions
- Should skills be per-project or global per-user?
- How to handle skill updates (new versions of a SKILL.md)?
- Should VibeIt auto-suggest skills based on the user's prompt (e.g. "build a dashboard with a database" → suggest `neon-database` skill)?
- Can we auto-detect missing env vars when a skill is enabled and prompt the user to add them?

