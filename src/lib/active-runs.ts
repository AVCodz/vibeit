/**
 * In-memory store for active Upstash Box StreamRun references.
 * Used to cancel running agent streams from a separate API endpoint.
 *
 * Keyed by runId (from the DB agent_runs table).
 * Entries are added when a stream starts and removed when it finishes/fails.
 */

type ActiveRunEntry = {
  cancel: () => Promise<void>;
  abortController: AbortController;
  projectId: string;
  createdAt: number;
};

const activeRuns = new Map<string, ActiveRunEntry>();

export function registerActiveRun(
  runId: string,
  entry: ActiveRunEntry,
) {
  activeRuns.set(runId, entry);
}

export function removeActiveRun(runId: string) {
  activeRuns.delete(runId);
}

export function getActiveRun(runId: string) {
  return activeRuns.get(runId) ?? null;
}

export function getActiveRunByProject(projectId: string) {
  for (const [runId, entry] of activeRuns) {
    if (entry.projectId === projectId) {
      return { runId, ...entry };
    }
  }
  return null;
}
