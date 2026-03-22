import { db } from "@/db";
import { projectSessions, projects } from "@/db/schema";
import { auth } from "@/lib/auth";
import { bootstrapProjectBox } from "@/lib/upstash-box";

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

    const box = await bootstrapProjectBox({ projectId: project.id });

    await db.insert(projectSessions).values({
      projectId: project.id,
      upstashBoxId: box.boxId,
      previewUrl: box.previewUrl,
      previewPort: box.previewPort,
      sessionStatus: "ready",
    });

    return Response.json({
      projectId: project.id,
      projectName: project.name,
      previewUrl: box.previewUrl,
      previewReachable: box.previewReachable,
      requestId,
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
