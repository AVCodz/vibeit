"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { HiPaperClip, HiArrowUp, HiLightBulb } from "react-icons/hi2";

export default function Home() {
  const [planActive, setPlanActive] = useState(false);

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 sm:px-6">
      <div className="w-full max-w-2xl text-center">
        <p className="mb-4 text-sm font-medium uppercase tracking-widest text-muted-foreground">
          AI-Powered Website Builder
        </p>

        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
          Turn Your Vision
          <br />
          Into Reality
        </h1>

        <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          Describe your idea in plain words and watch VibeIt transform it into a
          fully functional website — complete with codebase, live preview, and
          deployable files. In seconds, not days.
        </p>
      </div>

      <div className="mt-10 w-full max-w-2xl">
        <div className="rounded-xl border border-border/50 bg-card p-4">
          <textarea
            placeholder="Describe the website you want to build..."
            className="min-h-[100px] w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            rows={4}
          />
          <div className="flex items-center justify-between border-t border-border/40 pt-3">
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" type="button">
                <HiPaperClip className="size-4" />
              </Button>
              <Button
                variant={planActive ? "secondary" : "ghost"}
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
              <HiArrowUp className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
