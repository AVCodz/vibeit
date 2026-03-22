# Gaps To Address Tomorrow

## 1) Local cache for instant UI hydration
- Add localStorage-backed cache for project-level UI state:
  - project name
  - chat messages (user + assistant)
  - file list + selected file metadata
- Hydrate UI from localStorage immediately on project open, then reconcile with server responses.
- Keep cache scoped by `projectId` and add versioning/TTL to avoid stale/broken state.

## 2) Monaco should be read-only
- Disable direct editing in Monaco editor so users cannot modify files from editor UI.
- Keep file viewing/navigation intact.

## 3) Puppeteer thumbnail capture
- Integrate Puppeteer-based thumbnail generation for project previews.
- Use it in project close flow (best effort, with fallback on failure).

## 4) Auto-close inactive active projects
- Add scheduled cleanup job (cron) to detect projects/sessions still marked active but idle for 1-2 hours.
- For each idle active session:
  - sync workspace to Cloudflare R2
  - sync `project_files` metadata
  - close/delete Upstash box
  - update DB statuses accordingly

## 5) Enhance route improvements (OpenRouter)
- Improve/extend prompt enhancement route behavior via OpenRouter.
- Ensure enhancement output quality + reliability for longer prompts.

## 6) Chat modes: Plan Mode + Build Mode
- Add mode switch in chat:
  - Plan Mode: planning/spec output, no code-changing run
  - Build Mode: execute implementation run
- Persist selected mode per project/session and reflect mode in run pipeline.

## 7) Move terminal output out of chat bubbles
- Remove terminal/command operation logs from AI chat conversation stream.
- Add a dedicated terminal panel/component (preferably using `xterm`) for runtime command output.
- Show bootstrap/install/dev-server logs in that terminal view instead of assistant message area.
