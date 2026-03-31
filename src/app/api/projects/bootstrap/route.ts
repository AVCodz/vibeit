import { withBetterStack, type BetterStackRequest } from "@logtail/next";
import { db } from "@/db";
import { projectMessages, projects } from "@/db/schema";
import { auth } from "@/lib/auth";
import { serializeError } from "@/lib/better-stack";

type BootstrapProjectBody = {
  prompt?: string;
  requestId?: string;
};

function normalizeRequestId(input: string | undefined) {
  if (!input) {
    return crypto.randomUUID();
  }

  return input.slice(0, 128);
}

export const POST = withBetterStack(async (request: BetterStackRequest) => {
  const log = request.log.with({ route: "projects.bootstrap" });
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    log.warn("Unauthorized bootstrap attempt");
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as BootstrapProjectBody;
  const prompt = body.prompt?.trim();

  if (!prompt) {
    log.warn("Bootstrap rejected because prompt was missing", { userId: session.user.id });
    return Response.json({ error: "Prompt is required" }, { status: 400 });
  }

  const requestId = normalizeRequestId(body.requestId);

  try {
    const [project] = await db
      .insert(projects)
      .values({
        userId: session.user.id,
        name: "New Project",
        description: prompt,
        status: "active",
        r2Prefix: `projects/${session.user.id}/${requestId}`,
      })
      .returning({
        id: projects.id,
        name: projects.name,
      });

    const [userMessage] = await db
      .insert(projectMessages)
      .values({
        projectId: project.id,
        role: "user",
        content: prompt,
        status: "completed",
      })
      .returning({
        id: projectMessages.id,
        role: projectMessages.role,
        content: projectMessages.content,
        status: projectMessages.status,
      });

    const [assistantMessage] = await db
      .insert(projectMessages)
      .values({
        projectId: project.id,
        role: "assistant",
        content: "",
        status: "pending",
      })
      .returning({
        id: projectMessages.id,
        role: projectMessages.role,
        content: projectMessages.content,
        status: projectMessages.status,
      });

    log.info("Project bootstrapped", {
      userId: session.user.id,
      projectId: project.id,
      requestId,
    });

    return Response.json({
      projectId: project.id,
      projectName: project.name,
      requestId,
      initialUserMessage: userMessage,
      initialAssistantMessage: assistantMessage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to bootstrap project";

    log.error("Project bootstrap failed", {
      userId: session.user.id,
      requestId,
      ...serializeError(error),
    });

    return Response.json(
      {
        error: message,
      },
      { status: 500 },
    );
  }
});
