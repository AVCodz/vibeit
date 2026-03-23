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

  if (prompt.length > 12000) {
    return Response.json({
      enhancedPrompt: prompt,
      fallback: true,
      warning: "Prompt is too long to enhance",
    });
  }

  try {
    const enhancedPrompt = await enhancePrompt(prompt);

    if (!enhancedPrompt.trim()) {
      return Response.json({
        enhancedPrompt: prompt,
        fallback: true,
      });
    }

    return Response.json({ enhancedPrompt, fallback: false });
  } catch (error) {
    return Response.json({
      enhancedPrompt: prompt,
      fallback: true,
      warning: error instanceof Error ? error.message : "Failed to enhance prompt",
    });
  }
}
