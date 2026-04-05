"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type AgentPhase =
  | "analyzing"
  | "thinking"
  | "editing"
  | "installing"
  | "generating"
  | "preview"
  | "idle";

const PHASE_PHRASES: Record<AgentPhase, string[]> = {
  analyzing: [
    "Analyzing your request",
    "Understanding context",
    "Reading project structure",
    "Preparing a plan",
  ],
  thinking: [
    "Reasoning through problem",
    "Thinking deeply",
    "Evaluating approaches",
    "Forming a strategy",
  ],
  editing: [
    "Updating files",
    "Writing code changes",
    "Modifying components",
    "Applying edits",
  ],
  installing: [
    "Installing dependencies",
    "Resolving packages",
    "Setting up modules",
    "Configuring packages",
  ],
  generating: [
    "Generating response",
    "Composing output",
    "Writing explanation",
    "Crafting the answer",
  ],
  preview: [
    "Starting preview server",
    "Building for preview",
    "Launching dev server",
    "Preparing live preview",
  ],
  idle: ["Working on it"],
};

const CYCLE_INTERVAL = 2400;

function AgentStatusLoaderInner({
  phase,
  detail,
  className,
}: {
  phase: AgentPhase;
  detail?: string;
  className?: string;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const phrases = PHASE_PHRASES[phase] ?? PHASE_PHRASES.idle;

    const interval = setInterval(() => {
      setIsVisible(false);

      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % phrases.length);
        setIsVisible(true);
      }, 300);
    }, CYCLE_INTERVAL);

    return () => clearInterval(interval);
  }, [phase]);

  const phrases = PHASE_PHRASES[phase] ?? PHASE_PHRASES.idle;
  const currentPhrase = phrases[currentIndex % phrases.length];

  return (
    <span className={cn("inline-flex flex-col gap-1", className)}>
      <span className="inline-flex items-center gap-2">
        <span className="inline-flex items-center gap-1">
          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50" style={{ animationDelay: "0ms" }} />
          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50" style={{ animationDelay: "150ms" }} />
          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50" style={{ animationDelay: "300ms" }} />
        </span>
        <span
          key={currentIndex}
          className={cn(
            "text-muted-foreground/70",
            isVisible ? "animate-status-in" : "animate-status-out",
          )}
        >
          {currentPhrase}...
        </span>
      </span>
      {detail ? (
        <span className="truncate pl-6 font-mono text-[11px] text-muted-foreground/50">
          {detail}
        </span>
      ) : null}
    </span>
  );
}

// Key on phase so the inner component remounts and resets state on phase change
function AgentStatusLoader({
  phase = "analyzing",
  detail,
  className,
}: {
  phase?: AgentPhase;
  detail?: string;
  className?: string;
}) {
  return (
    <AgentStatusLoaderInner
      key={phase}
      phase={phase}
      detail={detail}
      className={className}
    />
  );
}

export { AgentStatusLoader };
export type { AgentPhase };

