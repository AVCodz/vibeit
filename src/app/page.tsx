"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { DottedSurface } from "@/components/ui/dotted-surface";
import { HiPaperClip, HiLightBulb } from "react-icons/hi2";
import { IoSend } from "react-icons/io5";

const PROMPT_PREFIX = "Ask VibeIt to ";
const PROMPT_SUFFIXES = [
  "create a website for a food ordering platform.",
  "create a website for a fitness coaching business.",
  "create a website for an AI travel planner startup.",
  "create a website for a portfolio with modern animations.",
];

export default function Home() {
  const [planActive, setPlanActive] = useState(false);

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

  return (
    <div className="flex flex-1  flex-col items-center justify-center px-4  sm:px-6">
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
        <div className="rounded-2xl border border-border/50 bg-card p-5">
          <textarea
            placeholder={`${PROMPT_PREFIX}${displayedText}`}
            className="min-h-[120px] w-full resize-none bg-transparent text-md text-foreground placeholder:text-muted-foreground focus:outline-none"
            rows={4}
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Button variant="secondary" size="icon-sm" type="button">
                <HiPaperClip className="size-4" />
              </Button>
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={() => setPlanActive(!planActive)}
                className="gap-1.5"
              >
                <HiLightBulb className="size-4" />
                Plan
              </Button>
            </div>
            <Button size="sm" type="button">
              <IoSend className="size-4 -rotate-45 -mr-1" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
