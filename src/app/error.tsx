"use client";

import { Button } from "@/components/ui/button";
import { useLogger } from "@logtail/next/hooks";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const log = useLogger({ source: "app/error.tsx" });

  useEffect(() => {
    log.error("Unhandled app error", {
      errorName: error.name,
      errorMessage: error.message,
      stack: error.stack,
      digest: error.digest,
    });
  }, [error, log]);

  return (
    <html lang="en" className="dark">
      <body className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="mt-3 text-sm text-muted-foreground">{error.message || "Unexpected application error."}</p>
          <Button className="mt-6" onClick={reset}>
            Try again
          </Button>
        </div>
      </body>
    </html>
  );
}
