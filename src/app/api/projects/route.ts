import { withBetterStack, type BetterStackRequest } from "@logtail/next";
import { query } from "@/db";
import { auth } from "@/lib/auth";
import { getRequestContext, serializeError } from "@/lib/better-stack";

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

export const GET = withBetterStack(async (request: BetterStackRequest) => {
  const startedAt = Date.now();
  const requestContext = getRequestContext(request);
  const log = request.log.with({ route: "projects.list", ...requestContext });
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    log.warn("Projects list request rejected", {
      outcome: "failure",
      statusCode: 401,
      durationMs: Date.now() - startedAt,
    });
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
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

    log.info("Projects list request completed", {
      outcome: "success",
      statusCode: 200,
      durationMs: Date.now() - startedAt,
      userId: session.user.id,
      projectCount: result.rows.length,
    });

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
  } catch (error) {
    log.error("Projects list request failed", {
      outcome: "error",
      statusCode: 500,
      durationMs: Date.now() - startedAt,
      userId: session.user.id,
      ...serializeError(error),
    });

    return Response.json({ error: "Failed to load projects" }, { status: 500 });
  }
});
