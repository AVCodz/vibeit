import { query } from "@/db";
import { auth } from "@/lib/auth";
import { capturePreviewThumbnail, syncProjectWorkspaceToR2, uploadProjectThumbnail } from "@/lib/r2";
import { getBoxById } from "@/lib/upstash-box";

type ProjectRow = {
  id: string;
  user_id: string;
  r2_prefix: string;
};

type SessionRow = {
  id: string;
  upstash_box_id: string | null;
  preview_url: string | null;
  session_status: string;
};

export async function POST(
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

  const activeSessionResult = await query<SessionRow>(
    "select id, upstash_box_id, preview_url, session_status from project_sessions where project_id = $1 order by created_at desc limit 1",
    [project.id],
  );

  const activeSession = activeSessionResult.rows[0];
  if (!activeSession?.upstash_box_id) {
    await query("update projects set status = $1, updated_at = $2 where id = $3", [
      "inactive",
      new Date(),
      project.id,
    ]);
    return Response.json({ projectId: project.id, closed: true, fileCount: 0 });
  }

  await query(
    "update project_sessions set session_status = $1, updated_at = $2 where id = $3",
    ["closing", new Date(), activeSession.id],
  );

  let thumbnailUrl: string | null = null;
  let fileCount = 0;

  try {
    const box = await getBoxById(activeSession.upstash_box_id);

    if (activeSession.preview_url) {
      try {
        const thumbnail = await capturePreviewThumbnail(activeSession.preview_url);
        thumbnailUrl = await uploadProjectThumbnail({
          r2Prefix: project.r2_prefix,
          bytes: thumbnail.bytes,
          contentType: thumbnail.contentType,
        });
      } catch {
        thumbnailUrl = null;
      }
    }

    const syncResult = await syncProjectWorkspaceToR2({
      box,
      r2Prefix: project.r2_prefix,
    });
    fileCount = syncResult.fileCount;

    await box.delete();

    await query(
      "update project_sessions set session_status = $1, ended_at = $2, updated_at = $3 where id = $4",
      ["closed", new Date(), new Date(), activeSession.id],
    );

    await query(
      "update projects set status = $1, thumbnail_url = coalesce($2, thumbnail_url), thumbnail_updated_at = case when $2 is null then thumbnail_updated_at else $3 end, updated_at = $3 where id = $4",
      ["inactive", thumbnailUrl, new Date(), project.id],
    );

    return Response.json({
      projectId: project.id,
      closed: true,
      fileCount,
      thumbnailUrl,
    });
  } catch (error) {
    await query(
      "update project_sessions set session_status = $1, updated_at = $2 where id = $3",
      ["error", new Date(), activeSession.id],
    );

    await query("update projects set status = $1, updated_at = $2 where id = $3", [
      "error",
      new Date(),
      project.id,
    ]);

    const message = error instanceof Error ? error.message : "Failed to close project";
    return Response.json({ error: message }, { status: 500 });
  }
}
