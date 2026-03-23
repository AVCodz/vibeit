# Gaps To Address Tomorrow

## 1) Auto-close inactive active projects
- Add scheduled cleanup job (cron) to detect projects/sessions still marked active but idle for 1-2 hours.
- For each idle active session:
  - sync workspace to Cloudflare R2
  - sync `project_files` metadata
  - close/delete Upstash box
  - update DB statuses accordingly

## 2) Enhance route improvements (OpenRouter)
- Improve/extend prompt enhancement route behavior via OpenRouter.
- Ensure enhancement output quality + reliability for longer prompts.

## 3) Optimize iteration latency — Preview health check skip
- **Problem**: After every build-mode run, `isProjectPreviewHealthy(box)` runs a remote shell command (~300-600ms) even when the agent only edited simple source files (`.tsx`, `.css`). Vite HMR handles those changes automatically — no server restart needed.
- **Solution (Hybrid Approach)**: Track file paths and shell commands from `tool-call` chunks during the stream. If no "restart trigger" file was touched (`package.json`, `vite.config.*`, `tsconfig.json`, `.env*`, lockfiles) and no install command ran (`npm install`, `pnpm add`, etc.), skip the health check entirely and re-emit the existing `preview_url` with zero latency.
- **Impact**: Saves ~300-600ms on ~90% of iterations (simple file edits). Full health check still runs when dependencies or config change.
- **Note on Bun**: Bun is NOT pre-installed in the Upstash Box `node` runtime (`sh: bun: not found`). Installing it adds ~2-3s overhead which partially offsets the ~5-9s install speedup. Lower priority than the preview optimization since bootstrap runs once per session, but preview check latency hits every single iteration.


## 4) Instant project close — three-layer approach (no new infra)
- **Problem**: Closing a project blocks the UI for several seconds (thumbnail capture, R2 sync, metadata sync, box deletion). Also, if the user just closes the browser tab, no cleanup happens at all.
- **Approach**: Three layers, zero new infrastructure beyond the cron already planned in gap #1.
- **Layer 1 — `after()` for explicit close (happy path)**:
  1. User clicks "Close". API marks session as `closing` and project as `inactive` in Neon, returns immediately.
  2. `after()` from `next/server` runs the heavy work after the response ships: capture thumbnail → sync workspace to R2 → sync file metadata to Neon → delete box → mark session `closed`.
  3. Runs in the same serverless invocation. No new service needed.
  4. If the function times out mid-cleanup, session stays `closing` — caught by Layer 3.
- **Layer 2 — `navigator.sendBeacon` for tab close (best-effort)**:
  1. Frontend registers a `beforeunload` listener that fires `navigator.sendBeacon('/api/projects/{id}/close')` when the user closes the tab or navigates away without clicking "Close".
  2. The beacon hits the same close endpoint, triggering the same `after()` background flow.
  3. Unreliable by nature (doesn't fire on crash, mobile kill, force-quit) — purely a best-effort optimization to catch the common "user just closes the tab" case.
- **Layer 3 — Cron safety net (guaranteed cleanup)**:
  1. The auto-close cron from gap #1 scans for sessions stuck in `closing` or `ready` that have been idle beyond a threshold (e.g. 1–2 hours).
  2. For each stale session: sync to R2 → sync metadata → delete box → mark closed.
  3. Catches everything Layer 1 and Layer 2 miss: serverless timeouts, crashes, mobile kills, force-quits.
- **Why no Redis/QStash**: Neon is already the source of truth — the `closing` status in `project_sessions` is the durable marker. Adding Redis would just be a middleman that doesn't execute anything. The cron reads directly from Neon. No extra infra to maintain.

## 5) Remove Plan button from landing page prompt input
- The initial post-sign-up landing page (`src/app/(main)/page.tsx`) currently shows a "Plan" toggle button in the prompt bar.
- Plan mode only makes sense inside an active project workspace — remove it from the landing page prompt input.

## 6) File attachment support in prompt input
- Allow users to attach files (images, text, PDFs, etc.) alongside their prompt.
- Upload attached files to R2 or pass them inline to the agent context.
- Show file previews/chips in the prompt bar before sending.

## 7) Voice input support (Whisper API)
- Add a microphone button to the prompt input bar.
- Record audio from the user's microphone, send it to the OpenAI Whisper API for transcription.
- Insert the transcribed text into the prompt input field.
- Handle permission prompts, recording state UI, and error states gracefully.