"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { HiPaperClip, HiLightBulb, HiEye, HiEyeSlash } from "react-icons/hi2";
import { IoSend } from "react-icons/io5";
import { FaGoogle, FaGithub, FaChevronLeft } from "react-icons/fa";
import { cn } from "@/lib/utils";

type AuthMode = "signin" | "signup";

const PROMPT_PREFIX = "Ask VibeIt to ";
const PROMPT_SUFFIXES = [
  "create a website for a food ordering platform.",
  "create a website for a fitness coaching business.",
  "create a website for an AI travel planner startup.",
  "create a website for a portfolio with modern animations.",
];

function AuthFormWrapper() {
  const searchParams = useSearchParams();
  const modeParam = searchParams.get("mode");
  const initialMode: AuthMode =
    modeParam === "signin" ? "signin" : "signup";

  return <AuthForm key={modeParam} initialMode={initialMode} />;
}

function AuthForm({ initialMode }: { initialMode: AuthMode }) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [showPassword, setShowPassword] = useState(false);
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
    <div className="grid min-h-screen w-full lg:grid-cols-2">
      {/* Left Panel - Desktop Only */}
      <div className="relative hidden border-r border-border bg-background lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_22%,rgba(161,161,170,0.02),transparent_42%),radial-gradient(circle_at_82%_76%,rgba(63,63,70,0.04),transparent_40%),linear-gradient(135deg,rgba(39,39,42,0.5),rgba(9,9,11,1))] opacity-70"
        />
        <div
          aria-hidden="true"
          className="bg-noise-strong pointer-events-none absolute inset-0 opacity-65 mix-blend-soft-light"
        />

        <div className="relative flex items-center gap-3">
          <Image src="/logo.png" alt="VibeIt logo" width={32} height={32} className="rounded-sm" />
          <span className="text-xl font-bold tracking-tight">VibeIt</span>
        </div>

        <div className="relative space-y-6">
          <h1 className="text-4xl font-bold leading-tight tracking-tighter md:text-5xl">
            Create something extraordinary today.
          </h1>

          <div className="mt-10 w-full max-w-3xl ">
            <div className="rounded-2xl border border-border/50 bg-background/20 p-4">
              <textarea
                value={`${PROMPT_PREFIX}${displayedText}`}
                readOnly
                className="min-h-[120px] w-full resize-none bg-transparent text-sm text-muted-foreground focus:outline-none"
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

        <div className="relative text-sm text-muted-foreground">
          &copy; {new Date().getFullYear()} VibeIt Inc.
        </div>
      </div>

      {/* Right Panel */}
      <div className="relative flex flex-col justify-center bg-background p-8 lg:p-12">
        <Link
          href="/"
          className="absolute left-8 top-8 flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <FaChevronLeft className="size-3" />
          Home
        </Link>

        <div className="mx-auto w-full max-w-sm space-y-8 text-left">

          {/* Auth Toggle */}
          <div className="space-y-6">
            <div className="space-y-2">
              <h2 className="text-2xl font-bold tracking-tight">
                {mode === "signin" ? "Welcome back" : "Create an account"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {mode === "signin"
                  ? "Enter your email to sign in to your account"
                  : "Enter your email below to create your account"}
              </p>
            </div>

                <div className="relative flex rounded-lg border border-border/40 bg-muted/50 p-1">
                <span
                    aria-hidden="true"
                    className={cn(
                      "absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-md bg-background shadow-sm transition-transform duration-300 ease-out",
                      mode === "signup" && "translate-x-full"
                    )}
                />
                <button
                    onClick={() => setMode("signin")}
                    aria-pressed={mode === "signin"}
                    className={cn(
                    "relative z-10 flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    mode === "signin"
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                >
                    Sign In
                </button>
                <button
                    onClick={() => setMode("signup")}
                    aria-pressed={mode === "signup"}
                    className={cn(
                    "relative z-10 flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    mode === "signup"
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                >
                Sign Up
              </button>
            </div>


          </div>

          {/* Form */}
          <form className="space-y-4">
            <div className="space-y-2">
                <label
                htmlFor="email"
                className="text-sm font-medium text-foreground"
              >
                Email
              </label>
              <Input id="email" type="email" placeholder="you@example.com" />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="password"
                  className="text-sm font-medium text-foreground"
                >
                  Password
                </label>
                {mode === "signin" && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showPassword ? (
                    <HiEyeSlash className="size-4" />
                  ) : (
                    <HiEye className="size-4" />
                  )}
                </button>
              </div>
            </div>

            <Button type="button" className="w-full">
              {mode === "signin" ? "Sign In" : "Create Account"}
            </Button>
          </form>

          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">Or continue with</span>
            <Separator className="flex-1" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button
              type="button"
              className="w-full bg-foreground text-background hover:bg-foreground/90"
            >
              <FaGoogle className="mr-2 size-4" />
              Google
            </Button>
            <Button
              type="button"
              className="w-full bg-foreground text-background hover:bg-foreground/90"
            >
              <FaGithub className="mr-2 size-4" />
              GitHub
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            {mode === "signin" ? (
              <>
                Don&apos;t have an account?{" "}
                <button
                  onClick={() => setMode("signup")}
                  className="font-medium text-foreground hover:underline"
                >
                  Sign up
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  onClick={() => setMode("signin")}
                  className="font-medium text-foreground hover:underline"
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense>
      <AuthFormWrapper />
    </Suspense>
  );
}
