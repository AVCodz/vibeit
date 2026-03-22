import { query } from "@/db";
import { auth } from "@/lib/auth";
import { generateProjectNameFromPrompt } from "@/lib/openrouter";
import { restoreProjectWorkspaceFromR2 } from "@/lib/r2";
import { bootstrapProjectBox, deleteBoxById, getBoxById, isProjectPreviewHealthy } from "@/lib/upstash-box";

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
    "select id, name, user_id, r2_prefix, description from projects where id = $1 and user_id = $2 limit 1",
    [projectId, session.user.id],
  );

  const project = projectResult.rows[0];
  if (!project) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseEvent(event, data)));
      };

      void (async () => {
        push("open.started", {
          projectId: project.id,
          projectName: project.name,
        });

        const projectDescription = project.description?.trim();

        const renamePromise =
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

        try {
          const latestSessionResult = await query<SessionRow>(
            "select id, upstash_box_id, preview_url, preview_port, session_status from project_sessions where project_id = $1 order by created_at desc limit 1",
            [project.id],
          );

          const latestSession = latestSessionResult.rows[0];

          if (
            latestSession?.upstash_box_id &&
            ["bootstrapped", "starting_preview", "ready"].includes(latestSession.session_status)
          ) {
            let previewUrl = latestSession.preview_url;

            if (latestSession.session_status === "ready" && latestSession.preview_url) {
              const existingBox = await getBoxById(latestSession.upstash_box_id);
              const healthy = await isProjectPreviewHealthy(existingBox).catch(() => false);

              if (!healthy) {
                previewUrl = null;
                await query(
                  "update project_sessions set preview_url = $1, session_status = $2, updated_at = $3 where id = $4",
                  [null, "bootstrapped", new Date(), latestSession.id],
                );
              }
            }

            push("open.ready", {
              projectId: project.id,
              projectName: project.name,
              sessionId: latestSession.id,
              previewUrl,
              previewReachable: Boolean(previewUrl),
            });

            await renamePromise;
            controller.close();
            return;
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
              skipPreviewStartup: true,
            },
          );

          const sessionInsertResult = await query<{ id: string }>(
            "insert into project_sessions (project_id, upstash_box_id, preview_url, preview_port, session_status, started_at, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id",
            [
              project.id,
              box.boxId,
              null,
              box.previewPort,
              "bootstrapped",
              new Date(),
              new Date(),
              new Date(),
            ],
          );

          await query(
            "update projects set status = $1, last_opened_at = $2, updated_at = $3 where id = $4",
            ["active", new Date(), new Date(), project.id],
          );

          push("open.ready", {
            projectId: project.id,
            projectName: project.name,
            sessionId: sessionInsertResult.rows[0]?.id,
            previewUrl: null,
            previewReachable: false,
          });

          await renamePromise;
          controller.close();
        } catch (error) {
          await query(
            "update project_messages set status = $1, updated_at = $2 where project_id = $3 and role = $4 and run_id is null and status in ($5, $6)",
            ["failed", new Date(), project.id, "assistant", "pending", "analyzing"],
          ).catch(() => undefined);

          await renamePromise;

          push("open.failed", {
            error: error instanceof Error ? error.message : "Failed to open project",
          });

          controller.close();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
