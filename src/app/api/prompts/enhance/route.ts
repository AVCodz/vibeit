import { withBetterStack, type BetterStackRequest } from "@logtail/next";
import { enhancePrompt } from "@/lib/openrouter";
import { auth } from "@/lib/auth";
import { serializeError } from "@/lib/better-stack";

type EnhancePromptBody = {
  prompt?: string;
};

export const POST = withBetterStack(async (request: BetterStackRequest) => {
  const log = request.log.with({ route: "prompts.enhance" });
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    log.warn("Unauthorized prompt enhancement attempt");
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as EnhancePromptBody;
  const prompt = body.prompt?.trim();

  if (!prompt) {
    log.warn("Prompt enhancement rejected because prompt was missing", { userId: session.user.id });
    return Response.json({ error: "Prompt is required" }, { status: 400 });
  }

  if (prompt.length > 12000) {
    log.warn("Prompt enhancement skipped because prompt was too long", {
      userId: session.user.id,
      promptLength: prompt.length,
    });
    return Response.json({
      enhancedPrompt: prompt,
      fallback: true,
      warning: "Prompt is too long to enhance",
    });
  }

  try {
    const enhancedPrompt = await enhancePrompt(prompt);

    if (!enhancedPrompt.trim()) {
      log.warn("Prompt enhancement returned empty content; falling back", {
        userId: session.user.id,
      });
      return Response.json({
        enhancedPrompt: prompt,
        fallback: true,
      });
    }

    log.info("Prompt enhanced", { userId: session.user.id, promptLength: prompt.length });

    return Response.json({ enhancedPrompt, fallback: false });
  } catch (error) {
    log.error("Prompt enhancement failed; returning fallback", {
      userId: session.user.id,
      ...serializeError(error),
    });

    return Response.json({
      enhancedPrompt: prompt,
      fallback: true,
      warning: error instanceof Error ? error.message : "Failed to enhance prompt",
    });
  }
});
