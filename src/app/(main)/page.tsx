"use client";

import { useLogger } from "@logtail/next/hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DottedSurface } from "@/components/ui/dotted-surface";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HiPaperAirplane, HiPaperClip, HiSparkles, HiXMark } from "react-icons/hi2";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";

const PROMPT_PREFIX = "Ask VibeIt to ";
const PROMPT_SUFFIXES = [
  "create a website for a food ordering platform.",
  "create a website for a fitness coaching business.",
  "create a website for an AI travel planner startup.",
  "create a website for a portfolio with modern animations.",
];

export default function Home() {
  const [promptValue, setPromptValue] = useState("");
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [pendingImages, setPendingImages] = useState<Array<{ id: string; file: File; previewUrl: string }>>([]);
  const hasNavigatedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { data: session } = useSession();
  const log = useLogger({ source: "app/(main)/page.tsx" });

  const [promptIndex, setPromptIndex] = useState(0);
  const [displayedText, setDisplayedText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const currentPrompt = PROMPT_SUFFIXES[promptIndex];
    const isDoneTyping = displayedText === currentPrompt;
    const isDoneDeleting = displayedText.length === 0;

    const timeout = setTimeout(
      () => {
        if (!isDeleting && isDoneTyping) {
          setIsDeleting(true);
          return;
        }

        if (isDeleting && isDoneDeleting) {
          setIsDeleting(false);
          setPromptIndex((prev) => (prev + 1) % PROMPT_SUFFIXES.length);
          return;
        }

        if (isDeleting) {
          setDisplayedText((prev) => prev.slice(0, -1));
        } else {
          setDisplayedText(currentPrompt.slice(0, displayedText.length + 1));
        }
      },
      !isDeleting && isDoneTyping
        ? 1400
        : isDeleting && isDoneDeleting
          ? 350
          : isDeleting
            ? 28
            : 42,
    );

    return () => clearTimeout(timeout);
  }, [displayedText, isDeleting, promptIndex]);

  const handleAttachFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;

    const newImages: typeof pendingImages = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file || !file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) continue;

      newImages.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }

    setPendingImages((current) => [...current, ...newImages].slice(0, 30));

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const removeImage = useCallback((imageId: string) => {
    setPendingImages((current) => {
      const removed = current.find((img) => img.id === imageId);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((img) => img.id !== imageId);
    });
  }, []);

  const handleSend = async () => {
    const prompt = promptValue.trim();

    if (!prompt) {
      return;
    }

    if (!session?.user) {
      log.warn("Anonymous user redirected to auth from landing prompt");
      router.push("/auth");
      return;
    }

    setIsBootstrapping(true);

    try {
      const response = await fetch("/api/projects/bootstrap", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          requestId: crypto.randomUUID(),
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        projectId?: string;
        previewUrl?: string;
        projectName?: string;
        initialUserMessage?: { id: string };
        initialAssistantMessage?: { id: string };
      };

      if (!response.ok || !data.projectId) {
        throw new Error(data.error ?? "Unable to bootstrap project");
      }

      // Upload images to the new project if any are attached
      const attachmentIds: string[] = [];

      if (pendingImages.length > 0) {
        for (const img of pendingImages) {
          const formData = new FormData();
          formData.append("file", img.file);

          const uploadResponse = await fetch(
            `/api/projects/${data.projectId}/attachments/upload`,
            { method: "POST", body: formData },
          );

          const uploadData = (await uploadResponse.json()) as {
            attachmentId?: string;
            error?: string;
          };

          if (uploadResponse.ok && uploadData.attachmentId) {
            attachmentIds.push(uploadData.attachmentId);
          }
        }

        // Clean up preview URLs
        for (const img of pendingImages) {
          URL.revokeObjectURL(img.previewUrl);
        }
        setPendingImages([]);
      }

      const url = new URL(`/projects/${data.projectId}`, window.location.origin);
      if (data.previewUrl) {
        url.searchParams.set("preview", data.previewUrl);
      }
      if (data.projectName) {
        url.searchParams.set("name", data.projectName);
      }
      url.searchParams.set("prompt", prompt);
      if (data.initialUserMessage?.id) {
        url.searchParams.set("umid", data.initialUserMessage.id);
      }
      if (data.initialAssistantMessage?.id) {
        url.searchParams.set("amid", data.initialAssistantMessage.id);
      }
      if (attachmentIds.length > 0) {
        url.searchParams.set("attachments", attachmentIds.join(","));
      }
      url.searchParams.set("autostart", "1");

      router.push(`${url.pathname}?${url.searchParams.toString()}`);
    } catch (error) {
      log.error("Landing page bootstrap failed", {
        promptLength: prompt.length,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsBootstrapping(false);
    }
  };

  const handleEnhance = async () => {
    const prompt = promptValue.trim();

    if (!prompt || !session?.user || isEnhancing) {
      return;
    }

    setIsEnhancing(true);

    try {
      const response = await fetch("/api/prompts/enhance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt }),
      });

      const data = (await response.json()) as {
        enhancedPrompt?: string;
        error?: string;
      };

      if (!response.ok || !data.enhancedPrompt) {
        throw new Error(data.error ?? "Unable to enhance prompt");
      }

      setPromptValue(data.enhancedPrompt);
    } catch (error) {
      log.error("Landing page prompt enhancement failed", {
        promptLength: prompt.length,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsEnhancing(false);
    }
  };

  return (
    <div className="flex flex-1  flex-col items-center justify-center px-4  sm:px-6">
      <div className="pointer-events-none fixed inset-0 -z-20 h-full w-full bg-[radial-gradient(circle_at_center,rgba(200,200,200,0.10),transparent_60%)]" />
      <DottedSurface />
      <div className="w-full max-w-2xl text-center">
        <p className="animate-fade-up mb-4 text-sm font-medium uppercase tracking-widest text-muted-foreground opacity-0 [animation-delay:200ms]">
          AI-Powered Website Builder
        </p>

        <h1 className="animate-fade-up text-4xl font-bold tracking-tight opacity-0 [animation-delay:400ms] sm:text-5xl lg:text-6xl">
          Turn Your Vision
          <br />
          Into Reality
        </h1>

        <p className="animate-fade-up mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground opacity-0 [animation-delay:600ms] sm:text-lg">
          Describe your idea in plain words and watch VibeIt transform it into a
          fully functional website — complete with codebase, live preview, and
          deployable files. In seconds, not days.
        </p>
      </div>

      <div className="animate-fade-up mt-10 w-full max-w-3xl mb-16 opacity-0 [animation-delay:800ms]">
        {pendingImages.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {pendingImages.map((img) => (
              <div key={img.id} className="group relative">
                <img
                  src={img.previewUrl}
                  alt={img.file.name}
                  className="size-16 rounded-xl border border-border/40 object-cover"
                />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 hidden rounded-b-xl bg-black/60 px-1.5 py-0.5 group-hover:block">
                  <span className="block truncate text-[10px] text-white">{img.file.name}</span>
                </div>
                <button
                  type="button"
                  onClick={() => removeImage(img.id)}
                  className="absolute cursor-pointer -top-1.5 -right-1.5 hidden size-4.5 items-center justify-center rounded-full bg-background/90 text-muted-foreground backdrop-blur-sm transition-colors hover:bg-red-500 hover:text-white group-hover:flex"
                  aria-label={`Remove ${img.file.name}`}
                >
                  <HiXMark className="size-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="relative rounded-2xl border border-border/50 bg-card p-5">
          {session?.user ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-sm"
                  type="button"
                  variant="secondary"
                  onClick={() => void handleEnhance()}
                  disabled={isEnhancing || isBootstrapping || !promptValue.trim()}
                  className="absolute top-5 right-5"
                  aria-label="Enhance prompt"
                >
                  <HiSparkles className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Enhance prompt</TooltipContent>
            </Tooltip>
          ) : null}
          <textarea
            value={promptValue}
            placeholder={`${PROMPT_PREFIX}${displayedText}`}
            className="min-h-[120px] w-full resize-none bg-transparent pr-10 text-md text-foreground placeholder:text-muted-foreground focus:outline-none"
            rows={4}
            onChange={(event) => {
              const nextValue = event.target.value;
              setPromptValue(nextValue);

              if (!hasNavigatedRef.current && nextValue.trim().length > 0) {
                if (!session?.user) {
                  hasNavigatedRef.current = true;
                  log.warn("Anonymous user redirected to auth after typing on landing page");
                  router.push("/auth");
                }
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (!isBootstrapping && promptValue.trim()) {
                  void handleSend();
                }
              }
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
            multiple
            className="hidden"
            onChange={(event) => handleAttachFiles(event.target.files)}
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="secondary"
                    size="icon-sm"
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Attach images"
                  >
                    <HiPaperClip className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Attach images</TooltipContent>
              </Tooltip>
            </div>
            <button
              type="button"
              disabled={isBootstrapping || !promptValue.trim()}
              onClick={() => void handleSend()}
              className="flex size-8 cursor-pointer items-center justify-center rounded-lg bg-foreground/10 text-muted-foreground transition-all duration-150 hover:bg-foreground/20 hover:text-foreground active:scale-95 disabled:pointer-events-none disabled:opacity-30"
              aria-label="Send message"
            >
              <HiPaperAirplane className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
