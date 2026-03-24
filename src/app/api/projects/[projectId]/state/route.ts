import { query } from "@/db";
import { auth } from "@/lib/auth";

type ProjectStateRow = {
  id: string;
  name: string;
  session_id: string | null;
  session_status: string | null;
  preview_url: string | null;
  upstash_box_id: string | null;
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
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  const hasActiveSession = Boolean(
    state.upstash_box_id &&
      ["bootstrapped", "starting_preview", "ready"].includes(state.session_status ?? ""),
  );
  const workspaceReady = ["bootstrapped", "starting_preview", "ready"].includes(
    state.session_status ?? "",
  );

  return Response.json({
    projectId: state.id,
    projectName: state.name,
    sessionId: state.session_id,
    sessionStatus: state.session_status,
    previewUrl: state.preview_url,
    hasActiveSession,
    workspaceReady,
  });
}
