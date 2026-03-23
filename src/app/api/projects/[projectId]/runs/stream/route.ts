import { query } from "@/db";
import { auth } from "@/lib/auth";
import { generateProjectNameFromPrompt } from "@/lib/openrouter";
import { syncProjectFilesMetadata } from "@/lib/project-files";
import { syncProjectWorkspaceToR2 } from "@/lib/r2";
import { ensureProjectPreview, getBoxById, isProjectPreviewHealthy, WORKDIR } from "@/lib/upstash-box";

type RunStreamBody = {
  prompt?: string;
  userMessageId?: string;
  assistantMessageId?: string;
  mode?: "build" | "plan";
};

type ProjectMessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: string;
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
  const body = (await request.json()) as RunStreamBody;
  const prompt = body.prompt?.trim();
  const mode = body.mode === "plan" ? "plan" : "build";

  if (!prompt) {
    return Response.json({ error: "Prompt is required" }, { status: 400 });
  }

  const projectResult = await query<{ id: string; name: string }>(
    "select id, name from projects where id = $1 and user_id = $2 limit 1",
    [projectId, session.user.id],
  );

  const project = projectResult.rows[0];

  if (!project) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  const activeSessionResult = await query<{
    id: string;
    upstash_box_id: string | null;
    preview_url: string | null;
  }>(
    "select id, upstash_box_id, preview_url from project_sessions where project_id = $1 order by created_at desc limit 1",
    [project.id],
  );

  const activeProjectSession = activeSessionResult.rows[0];

  if (!activeProjectSession?.upstash_box_id) {
    return Response.json({ error: "No active box session for project" }, { status: 409 });
  }

  const boxId = activeProjectSession.upstash_box_id;

  const runInsertResult = await query<{ id: string }>(
    "insert into agent_runs (project_id, session_id, prompt, status, started_at, created_at) values ($1, $2, $3, $4, $5, $6) returning id",
    [project.id, activeProjectSession.id, prompt, "running", new Date(), new Date()],
  );

  const run = runInsertResult.rows[0];

  let userMessage: ProjectMessageRow | undefined;
  let assistantMessage: ProjectMessageRow | undefined;

  if (body.userMessageId) {
    const userMessageResult = await query<ProjectMessageRow>(
      "select id, role, content, status from project_messages where project_id = $1 and id = $2 and role = $3 limit 1",
      [project.id, body.userMessageId, "user"],
    );

    const existingUserMessage = userMessageResult.rows[0];
    if (existingUserMessage) {
      await query(
        "update project_messages set run_id = $1, status = $2, content = $3, updated_at = $4 where id = $5",
        [run.id, "completed", prompt, new Date(), existingUserMessage.id],
      );

      userMessage = {
        ...existingUserMessage,
        content: prompt,
        status: "completed",
      };
    }
  }

  if (body.assistantMessageId) {
    const assistantMessageResult = await query<ProjectMessageRow>(
      "select id, role, content, status from project_messages where project_id = $1 and id = $2 and role = $3 limit 1",
      [project.id, body.assistantMessageId, "assistant"],
    );

    const existingAssistantMessage = assistantMessageResult.rows[0];
    if (existingAssistantMessage) {
      await query(
        "update project_messages set run_id = $1, status = $2, content = $3, updated_at = $4 where id = $5",
        [run.id, "analyzing", "", new Date(), existingAssistantMessage.id],
      );

      assistantMessage = {
        ...existingAssistantMessage,
        content: "",
        status: "analyzing",
      };
    }
  }

  if (!userMessage) {
    const userMessageInsertResult = await query<ProjectMessageRow>(
      "insert into project_messages (project_id, run_id, role, content, status, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7) returning id, role, content, status",
      [project.id, run.id, "user", prompt, "completed", new Date(), new Date()],
    );

    userMessage = userMessageInsertResult.rows[0];
  }

  if (!assistantMessage) {
    const assistantMessageInsertResult = await query<ProjectMessageRow>(
      "insert into project_messages (project_id, run_id, role, content, status, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7) returning id, role, content, status",
      [project.id, run.id, "assistant", "", "analyzing", new Date(), new Date()],
    );

    assistantMessage = assistantMessageInsertResult.rows[0];
  }

  if (!userMessage || !assistantMessage) {
    return Response.json({ error: "Unable to initialize messages for run" }, { status: 500 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseEvent(event, data)));
      };

      void (async () => {
        push("run.started", {
          runId: run.id,
          projectId: project.id,
          projectName: project.name,
          previewUrl: activeProjectSession.preview_url,
          mode,
          userMessage,
          assistantMessage,
        });

        const renameProjectPromise =
          project.name === "New Project"
            ? (async () => {
                const generatedName = await generateProjectNameFromPrompt(prompt);
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

        let assistantContent = "";

        try {
          const box = await getBoxById(boxId);
          await box.cd(WORKDIR);

          const runtimePrompt =
            mode === "plan"
              ? [
                  "You are in PLAN MODE for a Vite React TypeScript project.",
                  "Do not modify files.",
                  "Do not run shell commands that change project state.",
                  "Return a concise implementation plan, key file touchpoints, and acceptance checklist.",
                  prompt,
                ].join("\n\n")
              : [
                  "You are working inside a Vite React TypeScript project in the current directory.",
                  "Keep changes inside this project only.",
                  "Prefer editing existing React files instead of creating standalone HTML files.",
                  prompt,
                ].join("\n\n");

          const agentStream = await box.agent.stream({ prompt: runtimePrompt });

          for await (const chunk of agentStream) {
            if (chunk.type === "text-delta") {
              assistantContent += chunk.text;
              await query(
                "update project_messages set content = $1, status = $2, updated_at = $3 where id = $4",
                [assistantContent, "streaming", new Date(), assistantMessage.id],
              );
              push("run.text", { text: chunk.text });
              continue;
            }

            if (chunk.type === "reasoning") {
              push("run.reasoning", { text: chunk.text });
              continue;
            }

            if (chunk.type === "tool-call") {
              push("run.tool", { name: chunk.toolName, input: chunk.input });
              continue;
            }

            if (chunk.type === "stats") {
              push("run.stats", {
                cpuNs: chunk.cpuNs,
                memoryPeakBytes: chunk.memoryPeakBytes,
              });
              continue;
            }

            if (chunk.type === "finish") {
              if (assistantContent.length === 0 && chunk.output.trim().length > 0) {
                assistantContent = chunk.output;
              }

              await query(
                "update project_messages set content = $1, status = $2, updated_at = $3 where id = $4",
                [assistantContent, "completed", new Date(), assistantMessage.id],
              );

              push("run.finished", {
                output: assistantContent,
                usage: chunk.usage,
                sessionId: chunk.sessionId,
                assistantMessageId: assistantMessage.id,
              });
            }
          }

          await query(
            "update agent_runs set status = $1, completed_at = $2 where id = $3",
            ["completed", new Date(), run.id],
          );

          if (mode === "build") {
            const sessionStateResult = await query<{
              preview_url: string | null;
              preview_port: number | null;
              session_status: string;
            }>(
              "select preview_url, preview_port, session_status from project_sessions where id = $1 limit 1",
              [activeProjectSession.id],
            );

            const sessionState = sessionStateResult.rows[0];
            let previewNeedsStart = !sessionState?.preview_url;

            if (sessionState?.preview_url) {
              const previewHealthy = await isProjectPreviewHealthy(box);

              if (previewHealthy) {
                push("preview.ready", {
                  previewUrl: sessionState.preview_url,
                  previewReachable: true,
                });
              } else {
                await query(
                  "update project_sessions set preview_url = $1, session_status = $2, updated_at = $3 where id = $4",
                  [null, "bootstrapped", new Date(), activeProjectSession.id],
                );
                previewNeedsStart = true;
              }
            }

            if (previewNeedsStart) {
              const previewLockResult = await query<{ id: string }>(
                "update project_sessions set session_status = $1, updated_at = $2 where id = $3 and preview_url is null and (session_status <> $4 or updated_at < now() - interval '120 seconds') returning id",
                ["starting_preview", new Date(), activeProjectSession.id, "starting_preview"],
              );

              if (previewLockResult.rows[0]) {
                push("preview.status", {
                  message: "Starting preview server...",
                });

                const preview = await ensureProjectPreview(box, (event) => {
                  if (event.kind !== "status") {
                    return;
                  }

                  push("preview.status", {
                    message: event.message,
                  });
                });

                await query(
                  "update project_sessions set preview_url = $1, preview_port = $2, session_status = $3, updated_at = $4 where id = $5",
                  [preview.previewUrl, preview.previewPort, "ready", new Date(), activeProjectSession.id],
                );

                push("preview.ready", {
                  previewUrl: preview.previewUrl,
                  previewReachable: preview.previewReachable,
                });
              } else {
                let previewReady = false;

                for (let index = 0; index < 60; index += 1) {
                  await new Promise((resolve) => setTimeout(resolve, 1000));

                  const polledSessionResult = await query<{
                    preview_url: string | null;
                    session_status: string;
                  }>(
                    "select preview_url, session_status from project_sessions where id = $1 limit 1",
                    [activeProjectSession.id],
                  );
                  const polledSession = polledSessionResult.rows[0];

                  if (polledSession?.preview_url) {
                    push("preview.ready", {
                      previewUrl: polledSession.preview_url,
                      previewReachable: true,
                    });
                    previewReady = true;
                    break;
                  }

                  if (polledSession?.session_status === "failed") {
                    throw new Error("Preview startup failed");
                  }
                }

                if (!previewReady) {
                  throw new Error("Preview startup timed out");
                }
              }
            }
          }

          const syncResult = await query<{ r2_prefix: string }>(
            "select r2_prefix from projects where id = $1 limit 1",
            [project.id],
          );
          const r2Prefix = syncResult.rows[0]?.r2_prefix;
          if (r2Prefix) {
            const sync = await syncProjectWorkspaceToR2({ box, r2Prefix });
            await syncProjectFilesMetadata({
              projectId: project.id,
              files: sync.files,
            });
            push("files.synced", { fileCount: sync.fileCount });
          }

          await renameProjectPromise;

          push("run.completed", { runId: run.id });
          controller.close();
        } catch (error) {
          await renameProjectPromise;

          await query(
            "update project_messages set content = $1, status = $2, updated_at = $3 where id = $4",
            [
              assistantContent.length > 0
                ? assistantContent
                : error instanceof Error
                  ? error.message
                  : "Unknown run failure",
              "failed",
              new Date(),
              assistantMessage.id,
            ],
          );

          await query(
            "update agent_runs set status = $1, completed_at = $2, error_message = $3 where id = $4",
            [
              "failed",
              new Date(),
              error instanceof Error ? error.message : "Unknown run failure",
              run.id,
            ],
          );

          push("run.failed", {
            runId: run.id,
            error: error instanceof Error ? error.message : "Unknown run failure",
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
