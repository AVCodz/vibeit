import { withBetterStack, type BetterStackRequest } from "@logtail/next";
import { query } from "@/db";
import { auth } from "@/lib/auth";
import { getRequestContext, serializeError } from "@/lib/better-stack";
import { getBoxById, WORKDIR } from "@/lib/upstash-box";

type ProjectRow = {
  id: string;
};

type SessionRow = {
  upstash_box_id: string | null;
};

type FileEntry = {
  path: string;
  isDir: boolean;
};

const NORMALIZED_WORKDIR = WORKDIR.replace(/^\/+|\/+$/g, "");

function isHiddenWorkspacePath(path: string) {
  const normalized = path.replace(/^\/+/, "");
  const parts = normalized.split("/");
  const fileName = parts[parts.length - 1] ?? "";

  return (
    fileName.startsWith(".env") ||
    normalized === "node_modules" ||
    normalized.startsWith("node_modules/") ||
    normalized.includes("/node_modules/") ||
    normalized === ".git" ||
    normalized.startsWith(".git/") ||
    normalized.includes("/.git/")
  );
}

function toRelativePath(path: string) {
  const normalized = path.replace(/^\/+/, "");

  if (normalized === NORMALIZED_WORKDIR) {
    return "";
  }

  if (normalized.startsWith(`${NORMALIZED_WORKDIR}/`)) {
    return normalized.slice(NORMALIZED_WORKDIR.length + 1);
  }

  return normalized;
}

async function listRecursive(
  box: Awaited<ReturnType<typeof getBoxById>>,
  path = "",
): Promise<FileEntry[]> {
  const entries = await box.files.list(path || undefined);
  const result: FileEntry[] = [];

  for (const entry of entries) {
    const normalized = toRelativePath(entry.path);
    if (!normalized || isHiddenWorkspacePath(normalized)) {
      continue;
    }

    result.push({ path: normalized, isDir: entry.is_dir });

    if (entry.is_dir) {
      const nested = await listRecursive(box, normalized);
      result.push(...nested);
    }
  }

  return result;
}

export const GET = withBetterStack(async (
  request: BetterStackRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const startedAt = Date.now();
  const requestContext = getRequestContext(request);
  const log = request.log.with({ route: "projects.files", ...requestContext });
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    log.warn("Project files request rejected", {
      outcome: "failure",
      statusCode: 401,
      durationMs: Date.now() - startedAt,
    });
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await context.params;

  try {
    const projectResult = await query<ProjectRow>(
      "select id from projects where id = $1 and user_id = $2 limit 1",
      [projectId, session.user.id],
    );
    if (!projectResult.rows[0]) {
      log.warn("Project files request failed because project was missing", {
        outcome: "failure",
        statusCode: 404,
        durationMs: Date.now() - startedAt,
        userId: session.user.id,
        projectId,
      });
      return Response.json({ error: "Project not found" }, { status: 404 });
    }

    const sessionResult = await query<SessionRow>(
      "select upstash_box_id from project_sessions where project_id = $1 order by created_at desc limit 1",
      [projectId],
    );
    const boxId = sessionResult.rows[0]?.upstash_box_id;
    if (!boxId) {
      log.warn("Project files request failed because no active box was available", {
        outcome: "failure",
        statusCode: 409,
        durationMs: Date.now() - startedAt,
        userId: session.user.id,
        projectId,
      });
      return Response.json({ error: "No active box" }, { status: 409 });
    }

    const box = await getBoxById(boxId);
    await box.cd(WORKDIR);
    const entries = await listRecursive(box);

    log.info("Project files request completed", {
      outcome: "success",
      statusCode: 200,
      durationMs: Date.now() - startedAt,
      userId: session.user.id,
      projectId,
      entryCount: entries.length,
    });

    return Response.json({ entries });
  } catch (error) {
    log.error("Project files request failed", {
      outcome: "error",
      statusCode: 500,
      durationMs: Date.now() - startedAt,
      userId: session.user.id,
      projectId,
      ...serializeError(error),
    });
    const message = error instanceof Error ? error.message : "Failed to list files";
    return Response.json({ error: message }, { status: 500 });
  }
});
