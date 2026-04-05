import { withBetterStack, type BetterStackRequest } from "@logtail/next";
import { query } from "@/db";
import { auth } from "@/lib/auth";
import { generateProjectNameFromPrompt } from "@/lib/openrouter";
import { serializeError } from "@/lib/better-stack";
import { applyProjectEnvVarsToBox, ensureProjectPreview, getBoxById, isProjectPreviewHealthy, WORKDIR } from "@/lib/upstash-box";
import { registerActiveRun, removeActiveRun } from "@/lib/active-runs";

type RunMode = "build" | "plan";

type RunStreamBody = {
  prompt?: string;
  mentionedFilePaths?: unknown;
  attachmentIds?: unknown;
  userMessageId?: string;
  assistantMessageId?: string;
  mode?: RunMode;
};

type AttachmentRow = {
  id: string;
  filename: string;
  public_url: string;
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

function normalizeMentionedFilePaths(input: unknown) {
  if (!Array.isArray(input)) {
    return [] as string[];
  }

  const seen = new Set<string>();
  const paths: string[] = [];

  for (const value of input) {
    if (typeof value !== "string") {
      continue;
    }

    const normalized = value.trim().replace(/^\/+/, "");
    if (!normalized || normalized.includes("..") || normalized.startsWith(".env") || normalized.includes("/.env") || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    paths.push(normalized);

    if (paths.length >= 12) {
      break;
    }
  }

  return paths;
}

const OPEN_CODE_PLATFORM_RULES = [
  "You are VibeIt's OpenCode agent inside a Vite React TypeScript project in the current directory.",
  "This platform only supports Vite React TypeScript projects.",
  "Keep changes inside this project only.",
  "Prefer editing existing React files instead of creating standalone HTML files.",
  "Aim for production-quality UI by default: clean hierarchy, consistent spacing, strong typography, clear states, and polished responsive behavior.",
  "Use consistent component primitives and shadcn/ui-style patterns for UI cohesion unless the existing project already follows a different system.",
  "When working in a brand-new Vite project or a fresh scaffold without an established UI system, initialize shadcn/ui with the official CLI instead of only installing the package. For Vite, use the proper shadcn init flow such as `npx shadcn@latest init -t vite -d`, then add the components you need.",
  "For brand-new Vite projects, set up a polished frontend foundation early: initialize shadcn/ui properly and ensure framer-motion, lucide-react, class-variance-authority, clsx, and tailwind-merge are available when needed.",
  "Use icon packages for UI icons, preferably lucide-react, and do not use emojis as interface icons unless the user explicitly asks for emojis.",
  "Build responsive layouts with flexbox and grid, and make sure the result works well on mobile and desktop by default.",
  "Use framer-motion for meaningful UI motion and transitions when animation improves the experience; avoid gratuitous motion.",
  "Never create, modify, or commit `.env`, `.env.local`, `.env.*`, or other local secret files.",
  "When environment variables are needed, tell the user to add them in the Settings tab for this project instead of writing them to files.",
  "Assume project environment variables are injected by the platform after the user saves them in Settings.",
  "Never hardcode API keys, tokens, passwords, or other secrets in source files, examples, or fallback values.",
] as const;

type PromptAttachment = {
  filename: string;
  publicUrl: string;
};

function buildOpenCodeRuntimePrompt(
  mode: RunMode,
  prompt: string,
  mentionedFilePaths: string[],
  attachments: PromptAttachment[],
) {
  const mentionInstructions = mentionedFilePaths.length > 0
    ? [
        "The user explicitly mentioned these workspace files:",
        ...mentionedFilePaths.map((path) => `- ${path}`),
        "Inspect the mentioned files directly with filesystem tools before making changes when they are relevant.",
        "Treat the mentioned paths as high-priority hints, but do not assume their contents from the file names alone.",
      ]
    : [];

  const attachmentInstructions = attachments.length > 0
    ? [
        "The user attached these reference images. Examine them carefully and use them as visual context for the task:",
        ...attachments.map((a) => `- ${a.filename}: ${a.publicUrl}`),
      ]
    : [];

  const promptParts =
    mode === "plan"
      ? [
          ...OPEN_CODE_PLATFORM_RULES,
          ...mentionInstructions,
          ...attachmentInstructions,
          "You are in PLAN MODE.",
          "Do not modify files.",
          "Do not run shell commands that change project state.",
          "If the task requires environment variables, explicitly tell the user to add them in the Settings tab.",
          "Return a concise implementation plan, key file touchpoints, and acceptance checklist.",
          prompt,
        ]
      : [
          ...OPEN_CODE_PLATFORM_RULES,
          ...mentionInstructions,
          ...attachmentInstructions,
          "Implement the requested changes directly in this project.",
          "If environment variables are required, explain which variables are needed and direct the user to the Settings tab.",
          prompt,
        ];

  return promptParts.join("\n\n");
}

export const POST = withBetterStack(async (
  request: BetterStackRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const log = request.log.with({ route: "projects.runs.stream" });
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    log.warn("Unauthorized run attempt");
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await context.params;
  const body = (await request.json()) as RunStreamBody;
  const prompt = body.prompt?.trim();
  const mentionedFilePaths = normalizeMentionedFilePaths(body.mentionedFilePaths);
  const attachmentIds = Array.isArray(body.attachmentIds)
    ? (body.attachmentIds as unknown[]).filter((v): v is string => typeof v === "string").slice(0, 30)
    : [];
  const mode = body.mode === "plan" ? "plan" : "build";

  if (!prompt) {
    log.warn("Run rejected because prompt was missing", { projectId, userId: session.user.id });
    return Response.json({ error: "Prompt is required" }, { status: 400 });
  }

  const projectResult = await query<{ id: string; name: string }>(
    "select id, name from projects where id = $1 and user_id = $2 limit 1",
    [projectId, session.user.id],
  );

  const project = projectResult.rows[0];

  if (!project) {
    log.warn("Run requested for missing project", { projectId, userId: session.user.id });
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  const activeSessionResult = await query<{
    id: string;
    upstash_box_id: string | null;
    preview_url: string | null;
  }>(
    "select id, upstash_box_id, preview_url from project_sessions where project_id = $1 and session_status in ('bootstrapped', 'starting_preview', 'ready') order by created_at desc limit 1",
    [project.id],
  );

  const activeProjectSession = activeSessionResult.rows[0];

  if (!activeProjectSession?.upstash_box_id) {
    log.warn("Run requested without active box session", { projectId: project.id, userId: session.user.id });
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

  log.info("Project run started", {
    projectId: project.id,
    sessionId: activeProjectSession.id,
    runMode: mode,
    mentionedFileCount: mentionedFilePaths.length,
    userId: session.user.id,
  });

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

  // Resolve attachment URLs and link them to the user message
  let resolvedAttachments: AttachmentRow[] = [];

  if (attachmentIds.length > 0) {
    const attachmentsResult = await query<AttachmentRow>(
      "select id, filename, public_url from message_attachments where id = any($1::uuid[]) and project_id = $2",
      [attachmentIds, project.id],
    );
    resolvedAttachments = attachmentsResult.rows;

    if (resolvedAttachments.length > 0) {
      await query(
        "update message_attachments set message_id = $1 where id = any($2::uuid[])",
        [userMessage.id, resolvedAttachments.map((a) => a.id)],
      );
    }
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let streamClosed = false;

      const push = (event: string, data: unknown) => {
        if (streamClosed) return;
        try {
          controller.enqueue(encoder.encode(sseEvent(event, data)));
        } catch {
          streamClosed = true;
        }
      };

      const closeStream = () => {
        if (streamClosed) return;
        streamClosed = true;
        try { controller.close(); } catch { /* already closed */ }
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

          const runtimePrompt = buildOpenCodeRuntimePrompt(
            mode,
            prompt,
            mentionedFilePaths,
            resolvedAttachments.map((a) => ({ filename: a.filename, publicUrl: a.public_url })),
          );

          const agentStream = await box.agent.stream({ prompt: runtimePrompt });

          const runAbortController = new AbortController();
          registerActiveRun(run.id, {
            cancel: () => agentStream.cancel(),
            abortController: runAbortController,
            projectId: project.id,
            createdAt: Date.now(),
          });

          let dbFlushTimer: ReturnType<typeof setTimeout> | null = null;
          let dbFlushNeeded = false;

          const flushContentToDb = async () => {
            if (!dbFlushNeeded) return;
            dbFlushNeeded = false;
            await query(
              "update project_messages set content = $1, status = $2, updated_at = $3 where id = $4",
              [assistantContent, "streaming", new Date(), assistantMessage.id],
            );
          };

          const scheduleDbFlush = () => {
            dbFlushNeeded = true;
            if (dbFlushTimer) return;
            dbFlushTimer = setTimeout(() => {
              dbFlushTimer = null;
              void flushContentToDb();
            }, 300);
          };

          for await (const chunk of agentStream) {
            if (chunk.type === "text-delta") {
              assistantContent += chunk.text;
              scheduleDbFlush();
              push("run.text", { text: chunk.text });
              continue;
            }

            if (chunk.type === "reasoning") {
              push("run.reasoning", { text: chunk.text });
              continue;
            }

            if (chunk.type === "start") {
              push("run.agent-started", { runId: chunk.runId });
              continue;
            }

            if (chunk.type === "tool-call") {
              const truncatedInput: Record<string, unknown> = {};
              for (const [key, value] of Object.entries(chunk.input)) {
                if (typeof value === "string" && value.length > 500) {
                  truncatedInput[key] = value.slice(0, 500) + "…";
                } else {
                  truncatedInput[key] = value;
                }
              }
              push("run.tool", { name: chunk.toolName, input: truncatedInput });
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

              push("run.finished", {
                output: assistantContent,
                usage: chunk.usage,
                sessionId: chunk.sessionId,
                assistantMessageId: assistantMessage.id,
              });

              void query(
                "update project_messages set content = $1, status = $2, updated_at = $3 where id = $4",
                [assistantContent, "completed", new Date(), assistantMessage.id],
              );
            }
          }

          removeActiveRun(run.id);

          if (dbFlushTimer) clearTimeout(dbFlushTimer);
          await Promise.all([
            flushContentToDb(),
            query(
              "update agent_runs set status = $1, completed_at = $2 where id = $3",
              ["completed", new Date(), run.id],
            ),
          ]);

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
                await applyProjectEnvVarsToBox(box, project.id);

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

          await renameProjectPromise;

          log.info("Project run completed", {
            projectId: project.id,
            sessionId: activeProjectSession.id,
            runId: run.id,
            runMode: mode,
            userId: session.user.id,
          });

          push("run.completed", { runId: run.id });
          closeStream();
        } catch (error) {
          removeActiveRun(run.id);

          const isCancelled =
            error instanceof Error &&
            (error.name === "AbortError" || error.message.includes("cancel"));

          if (isCancelled) {
            log.info("Project run cancelled", {
              projectId: project.id,
              sessionId: activeProjectSession.id,
              runId: run.id,
              userId: session.user.id,
            });
          } else {
            log.error("Project run failed", {
              projectId: project.id,
              sessionId: activeProjectSession.id,
              runId: run.id,
              runMode: mode,
              userId: session.user.id,
              ...serializeError(error),
            });
          }

          await renameProjectPromise;

          const finalStatus = isCancelled ? "completed" : "failed";
          const finalRunStatus = isCancelled ? "cancelled" : "failed";

          await query(
            "update project_messages set content = $1, status = $2, updated_at = $3 where id = $4",
            [
              assistantContent.length > 0
                ? assistantContent
                : isCancelled
                  ? "Generation was stopped."
                  : error instanceof Error
                    ? error.message
                    : "Unknown run failure",
              finalStatus,
              new Date(),
              assistantMessage.id,
            ],
          );

          await query(
            "update agent_runs set status = $1, completed_at = $2, error_message = $3 where id = $4",
            [
              finalRunStatus,
              new Date(),
              isCancelled
                ? "Cancelled by user"
                : error instanceof Error
                  ? error.message
                  : "Unknown run failure",
              run.id,
            ],
          );

          if (isCancelled) {
            push("run.cancelled", {
              runId: run.id,
              output: assistantContent,
              assistantMessageId: assistantMessage.id,
            });
          } else {
            push("run.failed", {
              runId: run.id,
              error: error instanceof Error ? error.message : "Unknown run failure",
            });
          }
          closeStream();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
