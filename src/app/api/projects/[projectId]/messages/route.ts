import { query } from "@/db";
import { auth } from "@/lib/auth";

type ProjectMessageRow = {
  id: string;
  run_id: string | null;
  role: "user" | "assistant";
  content: string;
  status: string;
  created_at: string;
};

export async function GET(
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

  const messagesResult = await query<ProjectMessageRow>(
    "select id, run_id, role, content, status, created_at from project_messages where project_id = $1 order by created_at asc, id asc",
    [projectId],
  );

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
}
