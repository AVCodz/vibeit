import { auth } from "@/lib/auth";
import { query } from "@/db";
import { getActiveRunByProject } from "@/lib/active-runs";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await context.params;

  const projectResult = await query<{ id: string }>(
    "select id from projects where id = $1 and user_id = $2 limit 1",
    [projectId, session.user.id],
  );

  if (!projectResult.rows[0]) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  const activeRun = getActiveRunByProject(projectId);

  if (!activeRun) {
    return Response.json({ error: "No active run to cancel" }, { status: 404 });
  }

  try {
    activeRun.abortController.abort();
    await activeRun.cancel();
  } catch {
    // Run may have already finished between the check and cancel call
  }

  return Response.json({ cancelled: true, runId: activeRun.runId });
}
