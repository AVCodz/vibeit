"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HiEnvelope } from "react-icons/hi2";

export default function ContactPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6 sm:py-24">
      <div className="mb-12 text-center sm:mb-16">
        <p className="mb-3 text-sm font-medium uppercase tracking-widest text-muted-foreground">
          Contact
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Get in Touch
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground">
          Have a question, feedback, or partnership inquiry? We&apos;d love to
          hear from you.
        </p>
      </div>

      <div className="rounded-xl border border-border/40 bg-card p-6 sm:p-8">
        <form className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <label
                htmlFor="name"
                className="text-sm font-medium text-foreground"
              >
                Name
              </label>
              <Input id="name" placeholder="Your name" />
            </div>
            <div className="space-y-2">
              <label
                htmlFor="email"
                className="text-sm font-medium text-foreground"
              >
                Email
              </label>
              <Input id="email" type="email" placeholder="you@example.com" />
            </div>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="subject"
              className="text-sm font-medium text-foreground"
            >
              Subject
            </label>
            <select
              id="subject"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm text-foreground shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              defaultValue=""
            >
              <option value="" disabled>
                Select a topic
              </option>
              <option value="general">General Inquiry</option>
              <option value="bug">Bug Report</option>
              <option value="feature">Feature Request</option>
              <option value="partnership">Partnership</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="message"
              className="text-sm font-medium text-foreground"
            >
              Message
            </label>
            <textarea
              id="message"
              placeholder="Tell us more about your inquiry..."
              rows={5}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          <Button type="button" className="w-full sm:w-auto">
            Send Message
          </Button>
        </form>
      </div>

      <div className="mt-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <HiEnvelope className="size-4" />
        <span>hello@vibeit.dev</span>
      </div>
    </div>
  );
}
