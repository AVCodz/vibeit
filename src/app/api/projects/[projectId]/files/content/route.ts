import { query } from "@/db";
import { auth } from "@/lib/auth";
import { getBoxById, WORKDIR } from "@/lib/upstash-box";

type ProjectRow = {
  id: string;
};

type SessionRow = {
  upstash_box_id: string | null;
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

  if (normalized.startsWith(`${NORMALIZED_WORKDIR}/`)) {
    return normalized.slice(NORMALIZED_WORKDIR.length + 1);
  }

  return normalized;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await context.params;
  const { searchParams } = new URL(request.url);
  const path = toRelativePath((searchParams.get("path") ?? "").replace(/^\/+/, ""));

  if (!path || path.includes("..") || isHiddenWorkspacePath(path)) {
    return Response.json({ error: "Path is required" }, { status: 400 });
  }

  const projectResult = await query<ProjectRow>(
    "select id from projects where id = $1 and user_id = $2 limit 1",
    [projectId, session.user.id],
  );
  if (!projectResult.rows[0]) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  const sessionResult = await query<SessionRow>(
    "select upstash_box_id from project_sessions where project_id = $1 order by created_at desc limit 1",
    [projectId],
  );
  const boxId = sessionResult.rows[0]?.upstash_box_id;
  if (!boxId) {
    return Response.json({ error: "No active box" }, { status: 409 });
  }

  try {
    const box = await getBoxById(boxId);
    await box.cd(WORKDIR);
    const content = await box.files.read(path);
    return Response.json({ path, content });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read file";
    return Response.json({ error: message }, { status: 500 });
  }
}
