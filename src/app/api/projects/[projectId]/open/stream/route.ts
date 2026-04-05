import { withBetterStack, type BetterStackRequest } from "@logtail/next";
import { query } from "@/db";
import { auth } from "@/lib/auth";
import { serializeError } from "@/lib/better-stack";
import { generateProjectNameFromPrompt } from "@/lib/openrouter";
import { restoreProjectWorkspaceFromR2 } from "@/lib/r2";
import {
  applyProjectEnvVarsToBox,
  bootstrapProjectBox,
  deleteBoxById,
  ensureProjectPreview,
  getBoxById,
  isBoxReachable,
  isProjectPreviewHealthy,
} from "@/lib/upstash-box";

type ProjectRow = {
  id: string;
  name: string;
  user_id: string;
  r2_prefix: string;
  description: string | null;
};

type SessionRow = {
  id: string;
  upstash_box_id: string | null;
  preview_url: string | null;
  preview_port: number | null;
  session_status: string;
};

function sseEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function isClosedStreamControllerError(error: unknown) {
  return error instanceof TypeError && error.message.includes("Controller is already closed");
}

export const POST = withBetterStack(async (
  request: BetterStackRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const log = request.log.with({ route: "projects.open.stream" });
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    log.warn("Unauthorized streaming open attempt");
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await context.params;

  const projectResult = await query<ProjectRow>(
    "select id, name, user_id, r2_prefix, description from projects where id = $1 and user_id = $2 limit 1",
    [projectId, session.user.id],
  );

  const project = projectResult.rows[0];
  if (!project) {
    log.warn("Streaming open requested for missing project", { projectId, userId: session.user.id });
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  const encoder = new TextEncoder();
  let streamClosed = request.signal.aborted;
  let removeAbortListener: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (streamClosed) {
          return;
        }

        streamClosed = true;

        try {
          controller.close();
        } catch (error) {
          if (!isClosedStreamControllerError(error)) {
            throw error;
          }
        }
      };

      const push = (event: string, data: unknown) => {
        if (streamClosed) {
          return;
        }

        try {
          controller.enqueue(encoder.encode(sseEvent(event, data)));
        } catch (error) {
          if (isClosedStreamControllerError(error)) {
            streamClosed = true;
            return;
          }

          throw error;
        }
      };

      const handleAbort = () => {
        streamClosed = true;
      };

      request.signal.addEventListener("abort", handleAbort, { once: true });
      removeAbortListener = () => {
        request.signal.removeEventListener("abort", handleAbort);
      };

      void (async () => {
        let renamePromise: Promise<void> = Promise.resolve();

        try {
          push("open.started", {
            projectId: project.id,
            projectName: project.name,
          });

          const projectDescription = project.description?.trim();

          renamePromise =
            project.name === "New Project" && projectDescription
              ? (async () => {
                  const generatedName = await generateProjectNameFromPrompt(projectDescription);
                  if (!generatedName || generatedName === "New Project") {
                    return;
                  }

                  const renamedResult = await query<{ name: string }>(
                    "update projects set name = $1, updated_at = $2 where id = $3 and name = $4 returning name",
                    [generatedName, new Date(), project.id, "New Project"],
                  );

                  const renamedProject = renamedResult.rows[0];
                  if (renamedProject?.name) {
                    push("project.renamed", {
                      projectId: project.id,
                      name: renamedProject.name,
                    });
                  }
                })().catch(() => undefined)
              : Promise.resolve();

          const pendingInitialRunResult = await query<{ has_pending: boolean }>(
            `select exists(
              select 1
              from project_messages
              where project_id = $1
                and run_id is null
                and role = 'assistant'
                and status in ('pending', 'analyzing')
            ) as has_pending`,
            [project.id],
          );
          const hasPendingInitialRun = Boolean(pendingInitialRunResult.rows[0]?.has_pending);

          const latestSessionResult = await query<SessionRow>(
            "select id, upstash_box_id, preview_url, preview_port, session_status from project_sessions where project_id = $1 order by created_at desc limit 1",
            [project.id],
          );

          const latestSession = latestSessionResult.rows[0];

          const canReuseSession = Boolean(
            latestSession?.upstash_box_id &&
              ["bootstrapped", "starting_preview", "ready"].includes(latestSession.session_status),
          );

          if (latestSession?.upstash_box_id && canReuseSession) {
            const existingBox = await getBoxById(latestSession.upstash_box_id).catch(() => null);
            const boxReachable = existingBox ? await isBoxReachable(existingBox).catch(() => false) : false;

            if (!existingBox || !boxReachable) {
              await query(
                "update project_sessions set session_status = $1, ended_at = $2, updated_at = $3 where id = $4",
                ["closed", new Date(), new Date(), latestSession.id],
              );
            } else {
              let previewUrl = latestSession.preview_url;

              if (latestSession.session_status === "ready" && latestSession.preview_url) {
                const healthy = await isProjectPreviewHealthy(existingBox).catch(() => false);

                if (!healthy) {
                  previewUrl = null;
                  await query(
                    "update project_sessions set preview_url = $1, session_status = $2, updated_at = $3 where id = $4",
                    [null, "bootstrapped", new Date(), latestSession.id],
                  );
                }
              }

              if (!previewUrl && !hasPendingInitialRun) {
                await applyProjectEnvVarsToBox(existingBox, project.id);

                push("open.status", {
                  step: "start.preview",
                  message: "Starting preview server...",
                });

                const preview = await ensureProjectPreview(existingBox, (event) => {
                  if (event.kind === "status") {
                    push("open.status", {
                      step: event.step,
                      message: event.message,
                    });
                  }
                });

                previewUrl = preview.previewUrl;

                await query(
                  "update project_sessions set preview_url = $1, preview_port = $2, session_status = $3, updated_at = $4 where id = $5",
                  [preview.previewUrl, preview.previewPort, "ready", new Date(), latestSession.id],
                );
              }

              push("open.ready", {
                projectId: project.id,
                projectName: project.name,
                sessionId: latestSession.id,
                previewUrl,
                previewReachable: Boolean(previewUrl),
              });

              log.info("Reused existing project session", {
                projectId: project.id,
                sessionId: latestSession.id,
                userId: session.user.id,
                previewReachable: Boolean(previewUrl),
              });

              await renamePromise;
              close();
              return;
            }
          }

          if (latestSession?.upstash_box_id && latestSession.session_status !== "closed") {
            push("open.status", {
              step: "cleanup.previous",
              message: "Cleaning up previous workspace...",
            });

            await deleteBoxById(latestSession.upstash_box_id).catch(() => undefined);

            await query(
              "update project_sessions set session_status = $1, ended_at = $2, updated_at = $3 where id = $4",
              ["closed", new Date(), new Date(), latestSession.id],
            );
          }

          const box = await bootstrapProjectBox(
            { projectId: project.id },
            {
              beforeBootstrap: async (instance) => {
                push("open.status", {
                  step: "restore.workspace",
                  message: "Restoring workspace files...",
                });
                await restoreProjectWorkspaceFromR2({
                  box: instance,
                  r2Prefix: project.r2_prefix,
                });
              },
              onProgress: (event) => {
                if (event.kind === "status") {
                  push("open.status", {
                    step: event.step,
                    message: event.message,
                  });
                  return;
                }

                push("open.log", {
                  step: event.step,
                  message: event.message,
                });
              },
              skipPreviewStartup: hasPendingInitialRun,
            },
          );

          let sessionStatus = "bootstrapped";
          let previewUrl: string | null = null;
          let previewReachable = false;

          if (!hasPendingInitialRun) {
            push("open.status", {
              step: "start.preview",
              message: "Starting preview server...",
            });

            const preview = await ensureProjectPreview(await getBoxById(box.boxId), (event) => {
              if (event.kind === "status") {
                push("open.status", {
                  step: event.step,
                  message: event.message,
                });
              }
            });

            sessionStatus = "ready";
            previewUrl = preview.previewUrl;
            previewReachable = preview.previewReachable;
          }

          const sessionInsertResult = await query<{ id: string }>(
            "insert into project_sessions (project_id, upstash_box_id, preview_url, preview_port, session_status, started_at, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id",
            [
              project.id,
              box.boxId,
              previewUrl,
              box.previewPort,
              sessionStatus,
              new Date(),
              new Date(),
              new Date(),
            ],
          );

          await query(
            "update projects set status = $1, last_opened_at = $2, updated_at = $3 where id = $4",
            ["active", new Date(), new Date(), project.id],
          );

          const sessionId = sessionInsertResult.rows[0]?.id;

          log.info("Bootstrapped new project session", {
            projectId: project.id,
            sessionId,
            userId: session.user.id,
            previewReachable,
            hasPendingInitialRun,
          });

          push("open.ready", {
            projectId: project.id,
            projectName: project.name,
            sessionId,
            previewUrl,
            previewReachable,
          });

          await renamePromise;
          close();
        } catch (error) {
          log.error("Streaming open failed", {
            projectId: project.id,
            userId: session.user.id,
            ...serializeError(error),
          });

          await query(
            "update project_messages set status = $1, updated_at = $2 where project_id = $3 and role = $4 and run_id is null and status in ($5, $6)",
            ["failed", new Date(), project.id, "assistant", "pending", "analyzing"],
          ).catch(() => undefined);

          await renamePromise;

          push("open.failed", {
            error: error instanceof Error ? error.message : "Failed to open project",
          });

          close();
        } finally {
          removeAbortListener?.();
          removeAbortListener = null;
        }
      })();
    },
    cancel() {
      streamClosed = true;
      removeAbortListener?.();
      removeAbortListener = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
});
