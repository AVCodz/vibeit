import { withBetterStack, type BetterStackRequest } from "@logtail/next";
import { query } from "@/db";
import { serializeError } from "@/lib/better-stack";
import { syncProjectFilesMetadata } from "@/lib/project-files";
import { syncProjectWorkspaceToR2 } from "@/lib/r2";
import { getBoxById } from "@/lib/upstash-box";
import { timingSafeEqual } from "node:crypto";

type StaleSessionRow = {
  session_id: string;
  project_id: string;
  upstash_box_id: string | null;
  r2_prefix: string;
};

export const POST = withBetterStack(async (request: BetterStackRequest) => {
  const log = request.log.with({ route: "projects.cleanup" });
  const expectedSecret = process.env.CRON_SECRET;
  const requestSecret = request.headers.get("x-cron-secret");

  if (!expectedSecret || !requestSecret) {
    log.warn("Cleanup rejected because cron secret was missing");
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const expectedBuffer = Buffer.from(expectedSecret);
  const requestBuffer = Buffer.from(requestSecret);

  if (expectedBuffer.length !== requestBuffer.length || !timingSafeEqual(expectedBuffer, requestBuffer)) {
    log.warn("Cleanup rejected because cron secret was invalid");
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const staleSessionsResult = await query<StaleSessionRow>(
    `select
      ps.id as session_id,
      ps.project_id,
      ps.upstash_box_id,
      p.r2_prefix
    from project_sessions ps
    inner join projects p on p.id = ps.project_id
    where ps.session_status in ('bootstrapped', 'starting_preview', 'ready')
      and ps.updated_at < now() - interval '2 hours'
    order by ps.updated_at asc
    limit 50`,
  );

  const now = new Date();
  const results: Array<{ projectId: string; sessionId: string; syncedFiles: number; error?: string }> = [];

  for (const staleSession of staleSessionsResult.rows) {
    let syncedFiles = 0;
    let errorMessage: string | undefined;

    try {
      if (staleSession.upstash_box_id) {
        const box = await getBoxById(staleSession.upstash_box_id).catch(() => null);

        if (box) {
          const syncResult = await syncProjectWorkspaceToR2({
            box,
            r2Prefix: staleSession.r2_prefix,
          });
          await syncProjectFilesMetadata({
            projectId: staleSession.project_id,
            files: syncResult.files,
          });
          syncedFiles = syncResult.fileCount;

          await box.delete().catch(() => undefined);
        }
      }

      await query(
        "update project_sessions set session_status = $1, ended_at = $2, updated_at = $3 where id = $4",
        ["closed", now, now, staleSession.session_id],
      );

      await query(
        "update projects set status = $1, updated_at = $2 where id = $3",
        ["inactive", now, staleSession.project_id],
      );
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "cleanup failed";

      await query(
        "update project_sessions set session_status = $1, updated_at = $2 where id = $3",
        ["error", now, staleSession.session_id],
      ).catch(() => undefined);

      await query(
        "update projects set status = $1, updated_at = $2 where id = $3",
        ["error", now, staleSession.project_id],
      ).catch(() => undefined);

      log.error("Cleanup failed for stale project session", {
        projectId: staleSession.project_id,
        sessionId: staleSession.session_id,
        ...serializeError(error),
      });
    }

    results.push({
      projectId: staleSession.project_id,
      sessionId: staleSession.session_id,
      syncedFiles,
      error: errorMessage,
    });
  }

  return Response.json({
    scanned: staleSessionsResult.rows.length,
    closed: results.filter((result) => !result.error).length,
    failed: results.filter((result) => Boolean(result.error)).length,
    results,
  });
});
