import { GoDotFill } from "react-icons/go";
import { FaReact, FaGithub } from "react-icons/fa";
import {
  SiNextdotjs,
  SiTailwindcss,
  SiTypescript,
  SiVercel,
} from "react-icons/si";
import { HiPaperClip, HiLightBulb, HiMiniCursorArrowRays } from "react-icons/hi2";
import { IoMdSend } from "react-icons/io";
import Svg2 from "@/components/pixel-perfect/svg-2";
import Image from "next/image";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Features — VibeIt",
  description:
    "Explore how VibeIt turns your ideas into fully functional websites with AI-powered generation, live preview, and one-click deploy.",
};

const features = [
  {
    title: "Prompt to Production",
    description:
      "Describe Your Website In Natural Language. VibeIt Generates A Complete, Production-Ready Codebase — Not A Template, Real Code.",
    visual: "prompt",
  },
  {
    title: "Real-Time Preview",
    description:
      "Watch Your Website Come To Life As The AI Builds It. Every Component, Every Style Rendered Live In Your Browser.",
  },
  {
    title: "Full Codebase Export",
    description:
      "Download Clean, Well-Organized Project Files. Open In VS Code, Push To GitHub, Or Deploy Anywhere. The Code Is Yours.",
    visual: "workflow",
  },
  {
    title: "Iterative Refinement",
    description:
      "Not Perfect On The First Try? Describe What To Change And VibeIt Updates Instantly. Build Through Conversation, Not Configuration.",
  },
  {
    title: "Modern Tech Stack",
    description:
      "Every Website Is Built With React, Next.js, Tailwind CSS, And TypeScript. Industry-Standard Tools Developers Actually Use.",
    visual: "tech-stack",
  },
  {
    title: "One-Click Deploy",
    description:
      "Go From Idea To Live Website In Minutes. Deploy Directly To Vercel, Netlify, Or Download The Project To Host Anywhere.",
    visual: "deploy",
  },
];

function CornerDots() {
  return (
    <>
      <GoDotFill className="absolute z-10 top-1.5 left-1.5 size-3 text-muted-foreground" />
      <GoDotFill className="absolute z-10 top-1.5 right-1.5 size-3 text-muted-foreground" />
      <GoDotFill className="absolute z-10 bottom-1.5 left-1.5 size-3 text-muted-foreground" />
      <GoDotFill className="absolute z-10 bottom-1.5 right-1.5 size-3 text-muted-foreground" />
    </>
  );
}

function WorkflowVisual() {
  const steps = ["Generate", "Iterate", "Preview", "Export or Deploy"];
  
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden bg-background py-8">
      <div className="flex flex-col gap-[-20px] scale-75 ">
        {steps.map((step, i) => (
          <div key={step} className="relative flex items-center gap-3 justify-start" style={{ marginTop: i === 0 ? 0 : "-60px", zIndex: steps.length - i }}>
            <Svg2 className="h-28 shrink-0 w-44" />
            <div className="">
              <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground/80 hover:text-foreground transition-colors">
                {step}
              </span>
            </div>
          </div>
        ))}
      </div>
      
      {/* Connecting Line */}
      <div className="absolute left-1/2 top-10 bottom-10 w-px bg-gradient-to-b from-transparent via-border/50 to-transparent -translate-x-[50px] opacity-30" />
    </div>
  );
}

function PromptVisual() {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-background">
      {/* Background Grid */}
      <div className="absolute inset-0 grid grid-cols-4 grid-rows-4 gap-2 opacity-20 scale-110">
        {Array.from({ length: 24 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-foreground/20 bg-muted/50 backdrop-blur-sm"
          />
        ))}
      </div>

      {/* Floating Prompt Input */}
      <div className="relative z-10 w-[90%] max-w-[280px] rounded-xl border border-border bg-background p-3 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex-1 space-y-1">
            <p className="text-[10px] font-medium leading-relaxed text-muted-foreground">
              Create a modern landing page for a SaaS startup with dark mode and
              bento grids...
            </p>
          </div>
        </div>
        
        <div className="mt-3 flex items-center justify-between ">
          <div className="flex items-center gap-1">
            <div className="flex size-7 items-center justify-center rounded-md text-muted-foreground bg-muted/50">
              <HiPaperClip className="size-3.5" />
            </div>
            <div className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[10px] font-medium text-muted-foreground bg-muted/50 border border-transparent border-border/50 transition-colors">
              <HiLightBulb className="size-3" />
              Plan
            </div>
          </div>
          <div className="flex size-7 items-center justify-center rounded-lg bg-foreground text-background shadow-sm opacity-90">
             <IoMdSend className="size-4 -rotate-45 ml-1" />
          </div>
        </div>

        {/* Cursor Icon */}
        <div className="absolute bottom-3 right-1 translate-x-1/2 translate-y-1/2 ">
             <HiMiniCursorArrowRays className="size-8 text-foreground" />
        </div>
      </div>
    </div>
  );
}

function DeployVisual() {
  return (
    <div className="relative flex h-full w-full items-end justify-start overflow-hidden ">
      {/* Outer box — lightish grey, cropped into the bottom-right corner */}
      <div className="relative h-[75%] w-[85%] rounded-tr-xl bg-muted/30 border-t border-r border-border/40 p-2 pl-0 pb-0">
        {/* Inner box — darker grey */}
        <div className="relative h-full w-full rounded-tr-lg bg-neutral-950/10 border-t border-r border-border/30">
          {/* Buttons row — top-right corner of inner box */}
          <div className="absolute top-3 right-3 flex items-center gap-1.5">
            <div className="flex h-9 items-center rounded-md border border-border/50 bg-muted/60 px-5 text-md font-medium text-muted-foreground">
              Export
            </div>
            <div className="relative flex h-9 items-center rounded-md bg-foreground px-5 text-md font-medium text-background">
              Deploy
              {/* Cursor icon */}
              <HiMiniCursorArrowRays className="absolute -bottom-4 -right-3 size-7 text-foreground" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TechStackVisual() {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-gradient-to-b from-background/5 to-background/40">
      {/* Container for shifting the whole visual */}
      <div className="relative flex h-full w-full items-center justify-center -translate-y-4">
        {/* Background Radial Gradient Shine */}
        <div className="absolute left-1/2 top-1/2 h-[150%] w-[150%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_center,var(--foreground)_0%,transparent_60%)] opacity-[0.03] dark:opacity-[0.08]" />

        {/* Circle 1 (Inner) */}
        <div className="absolute left-1/2 top-1/2 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border/40" />

        {/* Circle 2 (Middle) */}
        <div className="absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border/30" />

        {/* Circle 3 (Outer) */}
        <div className="absolute left-1/2 top-1/2 h-72 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border/20" />

        {/* Central Logo */}
        <div className="relative z-10 flex items-center justify-center rounded-full bg-background border border-border shadow-2xl">
          <Image
            src="/logo.png"
            alt="VibeIt Logo"
            width={40}
            height={40}
            className="h-10 w-10 rounded-full object-contain "
          />
        </div>

        {/* Inner Circle Icons */}
        <div className="absolute inset-0">
          {/* Next.js - Top Left Inner */}
          <div className="absolute left-[24%] top-[35%] flex h-9 w-9 items-center justify-center rounded-full bg-background/90 border border-border shadow-sm z-10">
            <SiNextdotjs className="size-4 text-foreground" />
          </div>

          {/* Tailwind - Bottom Right Inner */}
          <div className="absolute right-[25%] bottom-[25%] flex h-9 w-9 items-center justify-center rounded-full bg-background/90 border border-border shadow-sm z-10">
            <SiTailwindcss className="size-4 text-foreground" />
          </div>
        </div>

        {/* Outer Circle Icons */}
        <div className="absolute inset-0">
          {/* React - Top Center Outer */}
          <div className="absolute left-1/2 top-[15%] -translate-x-3/4 flex h-10 w-10 items-center justify-center rounded-full bg-background/90 border border-border shadow-sm z-10">
            <FaReact className="size-5 text-foreground" />
          </div>

          {/* TypeScript - Left Outer */}
          <div className="absolute left-[5%] top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-background/90 border border-border shadow-sm z-10">
            <SiTypescript className="size-4 text-foreground" />
          </div>

          {/* Vercel - Right Outer */}
          <div className="absolute right-[5%] top-2/5 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-background/90 border border-border shadow-sm z-10">
            <SiVercel className="size-4 text-foreground" />
          </div>

          {/* Github - Bottom Center Outer */}
          <div className="absolute left-2/5 bottom-[5%] -translate-x-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-background/90 border border-border shadow-sm z-10">
            <FaGithub className="size-5 text-foreground" />
          </div>
        </div>
      </div>

      {/* Shine Overlay - Keep static relative to container */}
      <div className="absolute -top-[100%] left-1/2 h-[200%] w-[100px] -translate-x-1/2 rotate-45 bg-gradient-to-r from-transparent via-foreground/5 to-transparent blur-3xl pointer-events-none" />
    </div>
  );
}

export default function FeaturesPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 sm:py-24">
      <div className="mb-12 text-center sm:mb-16">
        <p className="mb-3 text-sm font-medium uppercase tracking-widest text-muted-foreground">
          What VibeIt Can Do
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Everything You Need to Go
          <br />
          From Idea to Production
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground">
          VibeIt handles the entire journey — from understanding your
          description to generating code, previewing it live, and deploying it
          to the web.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature) => (
          <div
            key={feature.title}
            className="overflow-hidden rounded-xl border border-border/40 bg-card"
          >
            <div className="relative m-3 aspect-[4/3] rounded-lg border border-border/30 bg-background/60 overflow-hidden">
              <CornerDots />
              <div className="absolute inset-0 rounded-lg bg-background/40">
                {feature.visual === "tech-stack" && <TechStackVisual />}
                {feature.visual === "prompt" && <PromptVisual />}
                {feature.visual === "workflow" && <WorkflowVisual />}
                {feature.visual === "deploy" && <DeployVisual />}
              </div>
            </div>

            <div className="px-4 pb-5">
              <h3 className="text-lg font-semibold tracking-tight">
                {feature.title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {feature.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
