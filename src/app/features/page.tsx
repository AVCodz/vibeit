import { GoDotFill } from "react-icons/go";
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
  },
  {
    title: "One-Click Deploy",
    description:
      "Go From Idea To Live Website In Minutes. Deploy Directly To Vercel, Netlify, Or Download The Project To Host Anywhere.",
  },
];

function CornerDots() {
  return (
    <>
      <GoDotFill className="absolute top-1.5 left-1.5 size-3 text-muted-foreground/50" />
      <GoDotFill className="absolute top-1.5 right-1.5 size-3 text-muted-foreground/50" />
      <GoDotFill className="absolute bottom-1.5 left-1.5 size-3 text-muted-foreground/50" />
      <GoDotFill className="absolute bottom-1.5 right-1.5 size-3 text-muted-foreground/50" />
    </>
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
            <div className="relative m-3 aspect-[4/3] rounded-lg border border-border/30 bg-background/60">
              <CornerDots />
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
