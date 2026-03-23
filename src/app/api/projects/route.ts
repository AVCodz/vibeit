import { query } from "@/db";
import { auth } from "@/lib/auth";

type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  thumbnail_url: string | null;
  last_opened_at: string | null;
  updated_at: string;
  created_at: string;
};

function resolveThumbnailUrl(value: string | null) {
  if (!value) {
    return null;
  }

  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }

  const publicBase = process.env.R2_PUBLIC_BASE_URL;
  if (!publicBase) {
    return null;
  }

  return `${publicBase.replace(/\/$/, "")}/${value.replace(/^\//, "")}`;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await query<ProjectRow>(
    `select
      id,
      name,
      description,
      status,
      thumbnail_url,
      last_opened_at,
      updated_at,
      created_at
    from projects
    where user_id = $1
    order by coalesce(last_opened_at, updated_at) desc`,
    [session.user.id],
  );

  return Response.json({
    projects: result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      thumbnailUrl: resolveThumbnailUrl(row.thumbnail_url),
      lastOpenedAt: row.last_opened_at,
      updatedAt: row.updated_at,
      createdAt: row.created_at,
    })),
  });
}
