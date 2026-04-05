import { withBetterStack, type BetterStackRequest } from "@logtail/next";
import { query } from "@/db";
import { auth } from "@/lib/auth";
import { getRequestContext, serializeError } from "@/lib/better-stack";

type ProjectMessageRow = {
  id: string;
  run_id: string | null;
  role: "user" | "assistant";
  content: string;
  status: string;
  created_at: string;
};

type AttachmentRow = {
  id: string;
  message_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  public_url: string;
};

export const GET = withBetterStack(async (
  request: BetterStackRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const startedAt = Date.now();
  const requestContext = getRequestContext(request);
  const log = request.log.with({ route: "projects.messages", ...requestContext });
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    log.warn("Project messages request rejected", {
      outcome: "failure",
      statusCode: 401,
      durationMs: Date.now() - startedAt,
    });
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await context.params;


  try {
    const projectResult = await query<{ id: string }>(
      "select id from projects where id = $1 and user_id = $2 limit 1",
      [projectId, session.user.id],
    );

    if (!projectResult.rows[0]) {
      log.warn("Project messages request failed because project was missing", {
        outcome: "failure",
        statusCode: 404,
        durationMs: Date.now() - startedAt,
        userId: session.user.id,
        projectId,
      });
      return Response.json({ error: "Project not found" }, { status: 404 });
    }

    const messagesResult = await query<ProjectMessageRow>(
      "select id, run_id, role, content, status, created_at from project_messages where project_id = $1 order by created_at asc, id asc",
      [projectId],
    );

    const messageIds = messagesResult.rows.map((row) => row.id);
    const attachmentsByMessage = new Map<string, AttachmentRow[]>();

    if (messageIds.length > 0) {
      const attachmentsResult = await query<AttachmentRow>(
        "select id, message_id, filename, content_type, size_bytes, public_url from message_attachments where message_id = any($1::uuid[])",
        [messageIds],
      );

      for (const row of attachmentsResult.rows) {
        const existing = attachmentsByMessage.get(row.message_id) ?? [];
        existing.push(row);
        attachmentsByMessage.set(row.message_id, existing);
      }
    }

    log.info("Project messages request completed", {
      outcome: "success",
      statusCode: 200,
      durationMs: Date.now() - startedAt,
      userId: session.user.id,
      projectId,
      messageCount: messagesResult.rows.length,
    });

    return Response.json({
      messages: messagesResult.rows.map((row) => {
        const attachments = attachmentsByMessage.get(row.id) ?? [];
        return {
          id: row.id,
          runId: row.run_id,
          role: row.role,
          content: row.content,
          status: row.status,
          createdAt: row.created_at,
          attachments: attachments.map((a) => ({
            id: a.id,
            filename: a.filename,
            contentType: a.content_type,
            sizeBytes: a.size_bytes,
            publicUrl: a.public_url,
          })),
        };
      }),
    });
  } catch (error) {
    log.error("Project messages request failed", {
      outcome: "error",
      statusCode: 500,
      durationMs: Date.now() - startedAt,
      userId: session.user.id,
      projectId,
      ...serializeError(error),
    });
    return Response.json({ error: "Failed to load project messages" }, { status: 500 });
  }
});
