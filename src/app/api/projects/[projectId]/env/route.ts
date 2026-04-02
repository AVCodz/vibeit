import { withBetterStack, type BetterStackRequest } from "@logtail/next";
import { query } from "@/db";
import { auth } from "@/lib/auth";
import { serializeError } from "@/lib/better-stack";
import { restoreProjectWorkspaceFromR2, syncProjectWorkspaceToR2 } from "@/lib/r2";
import {
  listProjectEnvVars,
  normalizeProjectEnvEntries,
  saveProjectEnvVars,
} from "@/lib/project-env";
import {
  bootstrapProjectBox,
  deleteBoxById,
  getBoxById,
  isBoxReachable,
} from "@/lib/upstash-box";

type ProjectRow = {
  id: string;
  r2_prefix: string;
};

type SessionRow = {
  id: string;
  upstash_box_id: string | null;
};

type RawProjectEnvInput = {
  key?: unknown;
  value?: unknown;
};

type SaveProjectEnvBody = {
  envVars?: RawProjectEnvInput[];
};

function parseProjectEnvBody(body: SaveProjectEnvBody) {
  if (!Array.isArray(body.envVars)) {
    throw new Error("envVars must be an array");
  }

  return body.envVars.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("Each environment variable must be an object");
    }

    if (entry.key !== undefined && typeof entry.key !== "string") {
      throw new Error("Environment variable keys must be strings");
    }

    if (entry.value !== undefined && typeof entry.value !== "string") {
      throw new Error("Environment variable values must be strings");
    }

    return {
      key: typeof entry.key === "string" ? entry.key : "",
      value: typeof entry.value === "string" ? entry.value : "",
    };
  });
}

async function validateProjectOwnership(projectId: string, userId: string) {
  const projectResult = await query<ProjectRow>(
    "select id, r2_prefix from projects where id = $1 and user_id = $2 limit 1",
    [projectId, userId],
  );

  return projectResult.rows[0] ?? null;
}

export const GET = withBetterStack(async (
  request: BetterStackRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const log = request.log.with({ route: "projects.env.get" });
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    log.warn("Unauthorized env read attempt");
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await context.params;
  const project = await validateProjectOwnership(projectId, session.user.id);

  if (!project) {
    log.warn("Env read requested for missing project", { projectId, userId: session.user.id });
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  const envVars = await listProjectEnvVars(projectId);
  log.info("Project env vars loaded", { projectId, userId: session.user.id, count: envVars.length });
  return Response.json({ envVars });
});

export const POST = withBetterStack(async (
  request: BetterStackRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const log = request.log.with({ route: "projects.env.save" });
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    log.warn("Unauthorized env save attempt");
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await context.params;
  const project = await validateProjectOwnership(projectId, session.user.id);

  if (!project) {
    log.warn("Env save requested for missing project", { projectId, userId: session.user.id });
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  let requestedEnvVars: ReturnType<typeof parseProjectEnvBody>;

  try {
    const body = (await request.json()) as SaveProjectEnvBody;
    requestedEnvVars = parseProjectEnvBody(body);
    normalizeProjectEnvEntries(requestedEnvVars);
  } catch (error) {
    log.warn("Invalid env save payload", {
      projectId,
      userId: session.user.id,
      ...serializeError(error),
    });

    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid environment variable payload" },
      { status: 400 },
    );
  }

  try {
    const envVars = await saveProjectEnvVars(projectId, requestedEnvVars);

    const sessionResult = await query<SessionRow>(
      "select id, upstash_box_id from project_sessions where project_id = $1 and session_status in ('bootstrapped', 'starting_preview', 'ready') order by created_at desc limit 1",
      [projectId],
    );

    const activeSession = sessionResult.rows[0];
    let previewRestarted = false;
    let previewUrl: string | null = null;
    let restartError: string | null = null;

    if (activeSession?.upstash_box_id) {
      const previousBoxId = activeSession.upstash_box_id;

      try {
        const existingBox = await getBoxById(previousBoxId).catch(() => null);
        const boxReachable = existingBox ? await isBoxReachable(existingBox).catch(() => false) : false;

        if (existingBox && boxReachable) {
          await syncProjectWorkspaceToR2({
            box: existingBox,
            r2Prefix: project.r2_prefix,
          });
        }

        const replacementBox = await bootstrapProjectBox(
          { projectId },
          {
            beforeBootstrap: async (instance) => {
              await restoreProjectWorkspaceFromR2({
                box: instance,
                r2Prefix: project.r2_prefix,
              });
            },
          },
        );

        await query(
          "update project_sessions set upstash_box_id = $1, preview_url = $2, preview_port = $3, session_status = $4, updated_at = $5 where id = $6",
          [replacementBox.boxId, replacementBox.previewUrl, replacementBox.previewPort, "ready", new Date(), activeSession.id],
        );

        previewRestarted = true;
        previewUrl = replacementBox.previewUrl;

        await deleteBoxById(previousBoxId).catch(() => undefined);
      } catch (error) {
        log.warn("Preview restart after env save failed", {
          projectId,
          sessionId: activeSession.id,
          userId: session.user.id,
          ...serializeError(error),
        });

        restartError = error instanceof Error ? error.message : "Failed to rebuild preview box";

        await query(
          "update project_sessions set preview_url = $1, session_status = $2, updated_at = $3 where id = $4",
          [null, "bootstrapped", new Date(), activeSession.id],
        ).catch(() => undefined);
      }
    }

    log.info("Project env vars saved", {
      projectId,
      userId: session.user.id,
      count: envVars.length,
      previewRestarted,
    });

    return Response.json({
      envVars,
      previewRestarted,
      previewUrl,
      restartError,
    });
  } catch (error) {
    log.error("Saving project env vars failed", {
      projectId,
      userId: session.user.id,
      ...serializeError(error),
    });

    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to save environment variables" },
      { status: 500 },
    );
  }
});
