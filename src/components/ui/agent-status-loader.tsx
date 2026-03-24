"use client";

import { useEffect, useState, useRef } from "react";
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

function AgentStatusLoader({
  phase = "analyzing",
  detail,
  className,
}: {
  phase?: AgentPhase;
  detail?: string;
  className?: string;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(true);
  const phaseRef = useRef(phase);

  useEffect(() => {
    if (phaseRef.current !== phase) {
      phaseRef.current = phase;
      setCurrentIndex(0);
      setIsVisible(true);
    }
  }, [phase]);

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
    <span className={cn("inline-flex flex-col gap-0.5", className)}>
      <span className="inline-flex items-center gap-1.5">
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-blue-400/60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-blue-400" />
        </span>
        <span
          key={`${phase}-${currentIndex}`}
          className={cn(
            "text-shimmer text-muted-foreground",
            isVisible ? "animate-status-in" : "animate-status-out",
          )}
        >
          {currentPhrase}
          <span className="tracking-widest">...</span>
        </span>
      </span>
      {detail ? (
        <span className="truncate pl-3 font-mono text-[11px] text-muted-foreground/60">
          {detail}
        </span>
      ) : null}
    </span>
  );
}

export { AgentStatusLoader };
export type { AgentPhase };

