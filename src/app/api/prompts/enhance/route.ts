import { enhancePrompt } from "@/lib/openrouter";
import { auth } from "@/lib/auth";

type EnhancePromptBody = {
  prompt?: string;
};

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as EnhancePromptBody;
  const prompt = body.prompt?.trim();

  if (!prompt) {
    return Response.json({ error: "Prompt is required" }, { status: 400 });
  }

  try {
    const enhancedPrompt = await enhancePrompt(prompt);
    return Response.json({ enhancedPrompt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to enhance prompt";
    return Response.json({ error: message }, { status: 500 });
  }
}
