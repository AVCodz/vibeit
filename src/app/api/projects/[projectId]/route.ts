import { withBetterStack, type BetterStackRequest } from "@logtail/next";
import { query } from "@/db";
import { auth } from "@/lib/auth";
import { getRequestContext, serializeError } from "@/lib/better-stack";
import { deleteAllProjectR2Objects } from "@/lib/r2";
import { deleteBoxById } from "@/lib/upstash-box";

type ProjectRow = {
  id: string;
  user_id: string;
  r2_prefix: string;
};

type SessionRow = {
  id: string;
  upstash_box_id: string | null;
  session_status: string;
};

export const PATCH = withBetterStack(async (
  request: BetterStackRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const startedAt = Date.now();
  const requestContext = getRequestContext(request);
  const log = request.log.with({ route: "projects.update", ...requestContext });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    log.warn("Project update request rejected", {
      outcome: "failure",
      statusCode: 401,
      durationMs: Date.now() - startedAt,
    });
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await context.params;
  const body = (await request.json()) as { name?: string };
  const name = body.name?.trim();

  if (!name || name.length === 0 || name.length > 200) {
    log.warn("Project update request rejected", {
      outcome: "failure",
      statusCode: 400,
      durationMs: Date.now() - startedAt,
      userId: session.user.id,
      projectId,
    });
    return Response.json({ error: "Name must be 1-200 characters" }, { status: 400 });
  }

  try {
    const result = await query<{ id: string }>(
      "update projects set name = $1, updated_at = $2 where id = $3 and user_id = $4 returning id",
      [name, new Date(), projectId, session.user.id],
    );

    if (result.rows.length === 0) {
      log.warn("Project update request failed because project was missing", {
        outcome: "failure",
        statusCode: 404,
        durationMs: Date.now() - startedAt,
        userId: session.user.id,
        projectId,
      });
      return Response.json({ error: "Project not found" }, { status: 404 });
    }

    log.info("Project updated", {
      outcome: "success",
      statusCode: 200,
      durationMs: Date.now() - startedAt,
      userId: session.user.id,
      projectId,
      projectName: name,
    });

    return Response.json({ success: true });
  } catch (error) {
    log.error("Project update request failed", {
      outcome: "error",
      statusCode: 500,
      durationMs: Date.now() - startedAt,
      userId: session.user.id,
      projectId,
      ...serializeError(error),
    });
    return Response.json({ error: "Failed to update project" }, { status: 500 });
  }
});

export const DELETE = withBetterStack(async (
  request: BetterStackRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const startedAt = Date.now();
  const requestContext = getRequestContext(request);
  const log = request.log.with({ route: "projects.delete", ...requestContext });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    log.warn("Project delete request rejected", {
      outcome: "failure",
      statusCode: 401,
      durationMs: Date.now() - startedAt,
    });
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await context.params;


  try {
    const projectResult = await query<ProjectRow>(
      "select id, user_id, r2_prefix from projects where id = $1 and user_id = $2 limit 1",
      [projectId, session.user.id],
    );

    const project = projectResult.rows[0];
    if (!project) {
      log.warn("Project delete request failed because project was missing", {
        outcome: "failure",
        statusCode: 404,
        durationMs: Date.now() - startedAt,
        userId: session.user.id,
        projectId,
      });
      return Response.json({ error: "Project not found" }, { status: 404 });
    }

    const sessionsResult = await query<SessionRow>(
      "select id, upstash_box_id, session_status from project_sessions where project_id = $1",
      [project.id],
    );

    for (const sess of sessionsResult.rows) {
      if (sess.upstash_box_id) {
        await deleteBoxById(sess.upstash_box_id).catch(() => undefined);
      }
    }

    await deleteAllProjectR2Objects(project.r2_prefix);
    await query("delete from projects where id = $1", [project.id]);

    log.info("Project deleted", {
      outcome: "success",
      statusCode: 200,
      durationMs: Date.now() - startedAt,
      userId: session.user.id,
      projectId: project.id,
      deletedSessionCount: sessionsResult.rows.length,
    });

    return Response.json({ success: true });
  } catch (error) {
    log.error("Project delete request failed", {
      outcome: "error",
      statusCode: 500,
      durationMs: Date.now() - startedAt,
      userId: session.user.id,
      projectId,
      ...serializeError(error),
    });
    return Response.json({ error: "Failed to delete project" }, { status: 500 });
  }
});
