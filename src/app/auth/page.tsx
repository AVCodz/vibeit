"use client";

import { useLogger } from "@logtail/next/hooks";
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FaChevronLeft } from "react-icons/fa";
import { FaGoogle } from "react-icons/fa6";
import { HiPaperClip, HiLightBulb } from "react-icons/hi2";
import { IoSend } from "react-icons/io5";
import { signIn, useSession } from "@/lib/auth-client";

const PROMPT_PREFIX = "Ask VibeIt to ";
const PROMPT_SUFFIXES = [
  "create a website for a food ordering platform.",
  "create a website for a fitness coaching business.",
  "create a website for an AI travel planner startup.",
  "create a website for a portfolio with modern animations.",
];

export default function AuthPage() {
  const router = useRouter();
  const { data: session, isPending: isSessionPending } = useSession();
  const log = useLogger({ source: "app/auth/page.tsx" });

  const [planActive, setPlanActive] = useState(false);
  const [promptIndex, setPromptIndex] = useState(0);
  const [displayedText, setDisplayedText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isSessionPending && session?.user) {
      log.info("Authenticated user visited auth page and was redirected", {
        userId: session.user.id,
      });
      router.replace("/");
    }
  }, [isSessionPending, log, router, session]);

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

  const handleGoogleAuth = async () => {
    setErrorMessage("");
    setIsSubmitting(true);

    log.info("Auth flow initiated", {
      authProvider: "google",
      authAction: "sign_in",
      origin: "auth_page",
    });

    try {
      const { error } = await signIn.social({
        provider: "google",
        callbackURL: "/",
      });

      if (error) {
        log.warn("Auth flow returned an immediate error", {
          authProvider: "google",
          authAction: "sign_in",
          origin: "auth_page",
          errorMessage: error.message ?? "Unknown auth error",
        });
        setErrorMessage(error.message ?? "Unable to continue with Google.");
        return;
      }

      log.info("Auth flow handed off to Better Auth", {
        authProvider: "google",
        authAction: "sign_in",
        origin: "auth_page",
      });
    } catch (error) {
      log.error("Auth flow failed on the client", {
        authProvider: "google",
        authAction: "sign_in",
        origin: "auth_page",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      });
      setErrorMessage("Unable to continue with Google.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="grid min-h-screen w-full lg:grid-cols-2">
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

          <div className="mt-10 w-full max-w-3xl">
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

      <div className="relative flex h-full flex-col items-center justify-center bg-background p-8 lg:p-12">
        <Link
          href="/"
          className="absolute left-4 top-4 flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:left-8 lg:top-8"
        >
          <FaChevronLeft className="size-3" />
          Back
        </Link>

        <div className="w-full max-w-sm">
          <Card className="border-none shadow-none sm:border sm:shadow-sm">
            <CardHeader className="space-y-1 text-center">
              <CardTitle className="text-2xl font-bold tracking-tight">Create your account</CardTitle>
              <CardDescription>
                Continue with Google to start building with VibeIt
              </CardDescription>
            </CardHeader>

            <CardContent>
              <div className="grid gap-3">
                <Button
                  type="button"
                  className="h-11 w-full bg-foreground font-medium text-background transition-all hover:bg-foreground/90"
                  disabled={isSubmitting}
                  onClick={handleGoogleAuth}
                >
                  <FaGoogle className="size-4" />
                  <span>{isSubmitting ? "Please wait..." : "Continue with Google"}</span>
                </Button>

                {errorMessage ? (
                  <p className="text-sm text-red-400">{errorMessage}</p>
                ) : null}
              </div>
            </CardContent>

            <CardFooter>
              <p className="w-full text-center text-xs text-muted-foreground">
                By continuing, you agree to our Terms and Privacy Policy.
              </p>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
