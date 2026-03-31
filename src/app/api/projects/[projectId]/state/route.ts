import { withBetterStack, type BetterStackRequest } from "@logtail/next";
import { query } from "@/db";
import { auth } from "@/lib/auth";
import { getRequestContext, serializeError } from "@/lib/better-stack";

type ProjectStateRow = {
  id: string;
  name: string;
  session_id: string | null;
  session_status: string | null;
  preview_url: string | null;
  upstash_box_id: string | null;
};

export const GET = withBetterStack(async (
  request: BetterStackRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const startedAt = Date.now();
  const requestContext = getRequestContext(request);
  const log = request.log.with({ route: "projects.state", ...requestContext });
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    log.warn("Project state request rejected", {
      outcome: "failure",
      statusCode: 401,
      durationMs: Date.now() - startedAt,
    });
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await context.params;


  try {
    const stateResult = await query<ProjectStateRow>(
      `select
        p.id,
        p.name,
        ps.id as session_id,
        ps.session_status,
        ps.preview_url,
        ps.upstash_box_id
      from projects p
      left join lateral (
        select id, session_status, preview_url, upstash_box_id
        from project_sessions
        where project_id = p.id
        order by created_at desc
        limit 1
      ) ps on true
      where p.id = $1 and p.user_id = $2
      limit 1`,
      [projectId, session.user.id],
    );

    const state = stateResult.rows[0];
    if (!state) {
      log.warn("Project state request failed because project was missing", {
        outcome: "failure",
        statusCode: 404,
        durationMs: Date.now() - startedAt,
        userId: session.user.id,
        projectId,
      });
      return Response.json({ error: "Project not found" }, { status: 404 });
    }

    const hasActiveSession = Boolean(
      state.upstash_box_id &&
        ["bootstrapped", "starting_preview", "ready"].includes(state.session_status ?? ""),
    );
    const workspaceReady = ["bootstrapped", "starting_preview", "ready"].includes(
      state.session_status ?? "",
    );

    log.info("Project state request completed", {
      outcome: "success",
      statusCode: 200,
      durationMs: Date.now() - startedAt,
      userId: session.user.id,
      projectId: state.id,
      sessionId: state.session_id,
      sessionStatus: state.session_status,
      hasActiveSession,
      workspaceReady,
    });

    return Response.json({
      projectId: state.id,
      projectName: state.name,
      sessionId: state.session_id,
      sessionStatus: state.session_status,
      previewUrl: state.preview_url,
      hasActiveSession,
      workspaceReady,
    });
  } catch (error) {
    log.error("Project state request failed", {
      outcome: "error",
      statusCode: 500,
      durationMs: Date.now() - startedAt,
      userId: session.user.id,
      projectId,
      ...serializeError(error),
    });

    return Response.json({ error: "Failed to load project state" }, { status: 500 });
  }
});
