const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_OPENROUTER_MODEL = "google/gemini-2.5-flash";

type OpenRouterMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OpenRouterResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

async function openRouterChat(messages: OpenRouterMessage[]) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const model = process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL;

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
      "X-OpenRouter-Title": "VibeIt",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      temperature: 0.4,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter request failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as OpenRouterResponse;
  const content = data.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("OpenRouter returned empty content");
  }

  return content;
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 50);
}

export async function generateProjectNameFromPrompt(prompt: string) {
  try {
    const content = await openRouterChat([
      {
        role: "system",
        content:
          "You name software projects. Return only a short project name in plain text, 2 to 4 words, title case, no punctuation.",
      },
      {
        role: "user",
        content: `Name this project based on the prompt:\n\n${prompt}`,
      },
    ]);

    return content.replace(/[\n\r]/g, " ").trim();
  } catch {
    const fallback = slugify(prompt) || "new-project";
    return fallback
      .split("-")
      .slice(0, 4)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }
}

export async function enhancePrompt(prompt: string) {
  if (!prompt.trim()) {
    return prompt;
  }

  const content = await openRouterChat([
    {
      role: "system",
      content:
        "You improve software build prompts for a platform that always generates Vite React TypeScript projects. Keep the user's intent unchanged. Keep the result simple, short, and clear. Only add small clarifications that make the request easier to implement. Do not turn the prompt into a long specification, detailed checklist, or verbose requirements document. Do not suggest or mention alternative frameworks, stacks, or setup options such as Next.js, Vue, Angular, Svelte, or plain HTML. Assume the implementation is always React in this project. Return only the improved prompt text with no preface, label, tag, or extra commentary.",
    },
    {
      role: "user",
      content: prompt,
    },
  ]);

  return content;
}
