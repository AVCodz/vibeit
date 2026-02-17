import {
  HiCodeBracket,
  HiEye,
  HiArrowDownTray,
  HiChatBubbleLeftRight,
  HiSquares2X2,
  HiRocketLaunch,
} from "react-icons/hi2";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Features — VibeIt",
  description:
    "Explore how VibeIt turns your ideas into fully functional websites with AI-powered generation, live preview, and one-click deploy.",
};

const features = [
  {
    icon: HiCodeBracket,
    title: "Prompt to Production",
    description:
      "Describe your website in natural language. VibeIt generates a complete, production-ready codebase — not a template, not a mockup, real code.",
  },
  {
    icon: HiEye,
    title: "Real-Time Preview",
    description:
      "Watch your website come to life as the AI builds it. See every component, every style rendered live in your browser as it is generated.",
  },
  {
    icon: HiArrowDownTray,
    title: "Full Codebase Export",
    description:
      "Download clean, well-organized project files. Open in VS Code, push to GitHub, or deploy anywhere. The code is entirely yours.",
  },
  {
    icon: HiChatBubbleLeftRight,
    title: "Iterative Refinement",
    description:
      "Not perfect on the first try? Describe what to change and VibeIt updates your website instantly. Build through conversation, not configuration.",
  },
  {
    icon: HiSquares2X2,
    title: "Modern Tech Stack",
    description:
      "Every website is built with React, Next.js, Tailwind CSS, and TypeScript. Industry-standard tools that developers actually use in production.",
  },
  {
    icon: HiRocketLaunch,
    title: "One-Click Deploy",
    description:
      "Go from idea to live website in minutes. Deploy directly to Vercel, Netlify, or download the complete project to host wherever you want.",
  },
];

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

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature) => (
          <div
            key={feature.title}
            className="rounded-xl border border-border/40 bg-card p-6"
          >
            <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-muted">
              <feature.icon className="size-5 text-foreground" />
            </div>
            <h3 className="mb-2 text-base font-semibold">{feature.title}</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {feature.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
