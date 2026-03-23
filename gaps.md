# Gaps To Address Tomorrow

## 1) Local cache for instant UI hydration
- Add localStorage-backed cache for project-level UI state:
  - project name
  - chat messages (user + assistant)
  - file list + selected file metadata
- Hydrate UI from localStorage immediately on project open, then reconcile with server responses.
- Keep cache scoped by `projectId` and add versioning/TTL to avoid stale/broken state.

## 2) Auto-close inactive active projects
- Add scheduled cleanup job (cron) to detect projects/sessions still marked active but idle for 1-2 hours.
- For each idle active session:
  - sync workspace to Cloudflare R2
  - sync `project_files` metadata
  - close/delete Upstash box
  - update DB statuses accordingly

## 3) Enhance route improvements (OpenRouter)
- Improve/extend prompt enhancement route behavior via OpenRouter.
- Ensure enhancement output quality + reliability for longer prompts.

## 4) Optimize iteration latency — Preview health check skip
- **Problem**: After every build-mode run, `isProjectPreviewHealthy(box)` runs a remote shell command (~300-600ms) even when the agent only edited simple source files (`.tsx`, `.css`). Vite HMR handles those changes automatically — no server restart needed.
- **Solution (Hybrid Approach)**: Track file paths and shell commands from `tool-call` chunks during the stream. If no "restart trigger" file was touched (`package.json`, `vite.config.*`, `tsconfig.json`, `.env*`, lockfiles) and no install command ran (`npm install`, `pnpm add`, etc.), skip the health check entirely and re-emit the existing `preview_url` with zero latency.
- **Impact**: Saves ~300-600ms on ~90% of iterations (simple file edits). Full health check still runs when dependencies or config change.
- **Note on Bun**: Bun is NOT pre-installed in the Upstash Box `node` runtime (`sh: bun: not found`). Installing it adds ~2-3s overhead which partially offsets the ~5-9s install speedup. Lower priority than the preview optimization since bootstrap runs once per session, but preview check latency hits every single iteration.
