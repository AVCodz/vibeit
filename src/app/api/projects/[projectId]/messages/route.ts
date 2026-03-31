import { withBetterStack, type BetterStackRequest } from "@logtail/next";
import { query } from "@/db";
import { auth } from "@/lib/auth";
import { getRequestContext, serializeError } from "@/lib/better-stack";

type ProjectMessageRow = {
  id: string;
  run_id: string | null;
  role: "user" | "assistant";
  content: string;
  status: string;
  created_at: string;
};

export const GET = withBetterStack(async (
  request: BetterStackRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const startedAt = Date.now();
  const requestContext = getRequestContext(request);
  const log = request.log.with({ route: "projects.messages", ...requestContext });
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    log.warn("Project messages request rejected", {
      outcome: "failure",
      statusCode: 401,
      durationMs: Date.now() - startedAt,
    });
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await context.params;


  try {
    const projectResult = await query<{ id: string }>(
      "select id from projects where id = $1 and user_id = $2 limit 1",
      [projectId, session.user.id],
    );

    if (!projectResult.rows[0]) {
      log.warn("Project messages request failed because project was missing", {
        outcome: "failure",
        statusCode: 404,
        durationMs: Date.now() - startedAt,
        userId: session.user.id,
        projectId,
      });
      return Response.json({ error: "Project not found" }, { status: 404 });
    }

    const messagesResult = await query<ProjectMessageRow>(
      "select id, run_id, role, content, status, created_at from project_messages where project_id = $1 order by created_at asc, id asc",
      [projectId],
    );

    log.info("Project messages request completed", {
      outcome: "success",
      statusCode: 200,
      durationMs: Date.now() - startedAt,
      userId: session.user.id,
      projectId,
      messageCount: messagesResult.rows.length,
    });

    return Response.json({
      messages: messagesResult.rows.map((row) => ({
        id: row.id,
        runId: row.run_id,
        role: row.role,
        content: row.content,
        status: row.status,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    log.error("Project messages request failed", {
      outcome: "error",
      statusCode: 500,
      durationMs: Date.now() - startedAt,
      userId: session.user.id,
      projectId,
      ...serializeError(error),
    });
    return Response.json({ error: "Failed to load project messages" }, { status: 500 });
  }
});
