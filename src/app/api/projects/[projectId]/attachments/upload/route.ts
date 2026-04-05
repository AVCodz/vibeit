import { auth } from "@/lib/auth";
import { query } from "@/db";
import {
  isAllowedImageType,
  isWithinAttachmentSizeLimit,
  uploadMessageAttachment,
} from "@/lib/r2";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await context.params;

  const projectResult = await query<{ id: string; r2_prefix: string }>(
    "select id, r2_prefix from projects where id = $1 and user_id = $2 limit 1",
    [projectId, session.user.id],
  );

  const project = projectResult.rows[0];

  if (!project) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }

  if (!isAllowedImageType(file.type)) {
    return Response.json(
      { error: "Unsupported file type. Allowed: png, jpg, jpeg, gif, webp, bmp, tiff" },
      { status: 400 },
    );
  }

  if (!isWithinAttachmentSizeLimit(file.size)) {
    return Response.json(
      { error: "File too large. Maximum size is 5MB" },
      { status: 400 },
    );
  }

  const attachmentId = crypto.randomUUID();
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { key, publicUrl } = await uploadMessageAttachment({
    r2Prefix: project.r2_prefix,
    attachmentId,
    filename: file.name,
    bytes,
    contentType: file.type,
  });

  await query(
    "insert into message_attachments (id, project_id, filename, content_type, size_bytes, r2_key, public_url, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)",
    [attachmentId, project.id, file.name, file.type, file.size, key, publicUrl, new Date()],
  );

  return Response.json({
    attachmentId,
    filename: file.name,
    contentType: file.type,
    sizeBytes: file.size,
    publicUrl,
  });
}
