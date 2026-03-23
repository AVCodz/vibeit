import { query } from "@/db";
import { auth } from "@/lib/auth";
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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await context.params;
  const body = (await request.json()) as { name?: string };
  const name = body.name?.trim();

  if (!name || name.length === 0 || name.length > 200) {
    return Response.json({ error: "Name must be 1-200 characters" }, { status: 400 });
  }

  const result = await query<{ id: string }>(
    "update projects set name = $1, updated_at = $2 where id = $3 and user_id = $4 returning id",
    [name, new Date(), projectId, session.user.id],
  );

  if (result.rows.length === 0) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  return Response.json({ success: true });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await context.params;

  const projectResult = await query<ProjectRow>(
    "select id, user_id, r2_prefix from projects where id = $1 and user_id = $2 limit 1",
    [projectId, session.user.id],
  );

  const project = projectResult.rows[0];
  if (!project) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  // Step 1: Kill every Upstash Box tied to this project (active or stale)
  const sessionsResult = await query<SessionRow>(
    "select id, upstash_box_id, session_status from project_sessions where project_id = $1",
    [project.id],
  );

  for (const sess of sessionsResult.rows) {
    if (sess.upstash_box_id) {
      await deleteBoxById(sess.upstash_box_id).catch(() => undefined);
    }
  }

  // Step 2: Purge all R2 objects (workspace files, thumbnails, manifest)
  await deleteAllProjectR2Objects(project.r2_prefix);

  // Step 3: Delete the project row — cascades to sessions, messages, files, agent_runs
  await query("delete from projects where id = $1", [project.id]);

  return Response.json({ success: true });
}

