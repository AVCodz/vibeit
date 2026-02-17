"use client";

import { useState } from "react";
import { HiChevronDown } from "react-icons/hi2";
import { cn } from "@/lib/utils";

const faqs = [
  {
    question: "What is VibeIt?",
    answer:
      "VibeIt is an AI-powered platform that transforms your text descriptions into fully functional websites. You describe what you want in plain language, and our AI generates a complete codebase with live preview — ready to deploy.",
  },
  {
    question: "How does the generation process work?",
    answer:
      "Type a description of the website you want into the prompt. Our AI analyzes your requirements, architects the solution, and generates clean, production-ready code. You get a live preview instantly and can iterate through conversation to refine the result.",
  },
  {
    question: "Do I need coding experience to use VibeIt?",
    answer:
      "Not at all. VibeIt is designed for everyone — from non-technical founders who want to bring their ideas to life, to experienced developers looking to prototype faster. Just describe what you need in plain language.",
  },
  {
    question: "What kind of websites can I build?",
    answer:
      "Anything you can describe. Landing pages, portfolios, dashboards, SaaS applications, e-commerce stores, blogs, admin panels, and more. If you can describe it, VibeIt can build it.",
  },
  {
    question: "Can I edit the generated code?",
    answer:
      "Yes. You receive the complete, well-structured codebase. Download the project files and open them in any code editor, or continue refining through conversation with VibeIt.",
  },
  {
    question: "What technologies does VibeIt use to generate websites?",
    answer:
      "VibeIt generates code using modern web technologies including React, Next.js, Tailwind CSS, and TypeScript. The output follows industry best practices and is production-ready out of the box.",
  },
  {
    question: "How is VibeIt different from traditional website builders?",
    answer:
      "Traditional builders give you drag-and-drop templates with limited customization. VibeIt generates real, custom code from your exact requirements. No templates, no constraints — every website is built from scratch based on your description.",
  },
  {
    question: "Is my data secure?",
    answer:
      "Yes. Your prompts and generated code are encrypted and private. We do not use your data to train our models or share it with third parties.",
  },
];

function FAQItem({
  question,
  answer,
}: {
  question: string;
  answer: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-border/40">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between py-5 text-left"
      >
        <span className="text-sm font-medium sm:text-base">{question}</span>
        <HiChevronDown
          className={cn(
            "ml-4 size-4 shrink-0 text-muted-foreground",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (
        <p className="pb-5 text-sm leading-relaxed text-muted-foreground">
          {answer}
        </p>
      )}
    </div>
  );
}

export default function FAQsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
      <div className="mb-12 text-center sm:mb-16">
        <p className="mb-3 text-sm font-medium uppercase tracking-widest text-muted-foreground">
          FAQs
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Frequently Asked Questions
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground">
          Everything you need to know about VibeIt. Can&apos;t find what
          you&apos;re looking for? Reach out through our contact page.
        </p>
      </div>

      <div className="divide-y-0">
        {faqs.map((faq) => (
          <FAQItem key={faq.question} question={faq.question} answer={faq.answer} />
        ))}
      </div>
    </div>
  );
}
