import { db } from "@/db";
import { projectMessages, projects } from "@/db/schema";
import { auth } from "@/lib/auth";

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

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as BootstrapProjectBody;
  const prompt = body.prompt?.trim();

  if (!prompt) {
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

    return Response.json({
      projectId: project.id,
      projectName: project.name,
      requestId,
      initialUserMessage: userMessage,
      initialAssistantMessage: assistantMessage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to bootstrap project";

    return Response.json(
      {
        error: message,
      },
      { status: 500 },
    );
  }
}
