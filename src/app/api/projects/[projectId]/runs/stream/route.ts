import { query } from "@/db";
import { auth } from "@/lib/auth";
import { generateProjectNameFromPrompt } from "@/lib/openrouter";
import { syncProjectWorkspaceToR2 } from "@/lib/r2";
import { getBoxById, WORKDIR } from "@/lib/upstash-box";

type RunStreamBody = {
  prompt?: string;
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
        });

        const renameProjectPromise =
          project.name === "New Project"
            ? (async () => {
                const generatedName = await generateProjectNameFromPrompt(prompt);
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
          const box = await getBoxById(boxId);
          await box.cd(WORKDIR);

          const runtimePrompt = [
            "You are working inside a Vite React TypeScript project in the current directory.",
            "Keep changes inside this project only.",
            "Prefer editing existing React files instead of creating standalone HTML files.",
            prompt,
          ].join("\n\n");

          const agentStream = await box.agent.stream({ prompt: runtimePrompt });

          for await (const chunk of agentStream) {
            if (chunk.type === "text-delta") {
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
              push("run.finished", {
                output: chunk.output,
                usage: chunk.usage,
                sessionId: chunk.sessionId,
              });
            }
          }

          await query(
            "update agent_runs set status = $1, completed_at = $2 where id = $3",
            ["completed", new Date(), run.id],
          );

          const syncResult = await query<{ r2_prefix: string }>(
            "select r2_prefix from projects where id = $1 limit 1",
            [project.id],
          );
          const r2Prefix = syncResult.rows[0]?.r2_prefix;
          if (r2Prefix) {
            const sync = await syncProjectWorkspaceToR2({ box, r2Prefix });
            push("files.synced", { fileCount: sync.fileCount });
          }

          await renameProjectPromise;

          push("run.completed", { runId: run.id });
          controller.close();
        } catch (error) {
          await renameProjectPromise;

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
