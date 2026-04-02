import { withBetterStack, type BetterStackRequest } from "@logtail/next";
import { query } from "@/db";
import { auth } from "@/lib/auth";
import { serializeError } from "@/lib/better-stack";
import { restoreProjectWorkspaceFromR2 } from "@/lib/r2";
import { bootstrapProjectBox, deleteBoxById } from "@/lib/upstash-box";

type ProjectRow = {
  id: string;
  name: string;
  user_id: string;
  r2_prefix: string;
};

type SessionRow = {
  id: string;
  upstash_box_id: string | null;
  session_status: string;
};

export const POST = withBetterStack(async (
  request: BetterStackRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const log = request.log.with({ route: "projects.open" });
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    log.warn("Unauthorized project open attempt");
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await context.params;

  const projectResult = await query<ProjectRow>(
    "select id, name, user_id, r2_prefix from projects where id = $1 and user_id = $2 limit 1",
    [projectId, session.user.id],
  );

  const project = projectResult.rows[0];
  if (!project) {
    log.warn("Project open requested for missing project", { projectId, userId: session.user.id });
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  const latestSessionResult = await query<SessionRow>(
    "select id, upstash_box_id, session_status from project_sessions where project_id = $1 order by created_at desc limit 1",
    [project.id],
  );

  const latestSession = latestSessionResult.rows[0];
  if (latestSession?.upstash_box_id && latestSession.session_status !== "closed") {
    await deleteBoxById(latestSession.upstash_box_id).catch(() => undefined);

    await query(
      "update project_sessions set session_status = $1, ended_at = $2, updated_at = $3 where id = $4",
      ["closed", new Date(), new Date(), latestSession.id],
    );
  }

  try {
    const box = await bootstrapProjectBox(
      { projectId: project.id },
      {
        beforeBootstrap: async (instance) => {
          await restoreProjectWorkspaceFromR2({
            box: instance,
            r2Prefix: project.r2_prefix,
          });
        },
      },
    );

    const sessionInsertResult = await query<{ id: string }>(
      "insert into project_sessions (project_id, upstash_box_id, preview_url, preview_port, session_status, started_at, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id",
      [
        project.id,
        box.boxId,
        box.previewUrl,
        box.previewPort,
        "ready",
        new Date(),
        new Date(),
        new Date(),
      ],
    );

    await query(
      "update projects set status = $1, last_opened_at = $2, updated_at = $3 where id = $4",
      ["active", new Date(), new Date(), project.id],
    );

    const sessionId = sessionInsertResult.rows[0]?.id;

    log.info("Project opened", {
      projectId: project.id,
      sessionId,
      userId: session.user.id,
      previewReachable: box.previewReachable,
    });

    return Response.json({
      projectId: project.id,
      projectName: project.name,
      sessionId,
      previewUrl: box.previewUrl,
      previewReachable: box.previewReachable,
    });
  } catch (error) {
    log.error("Project open failed", {
      projectId: project.id,
      userId: session.user.id,
      ...serializeError(error),
    });

    const message = error instanceof Error ? error.message : "Failed to open project";
    return Response.json({ error: message }, { status: 500 });
  }
});
