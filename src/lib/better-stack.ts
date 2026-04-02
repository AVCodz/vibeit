import { Logger } from "@logtail/next";
import type { BetterStackRequest } from "@logtail/next";

export function createServerLogger(source: string, fields?: Record<string, unknown>) {
  const logger = new Logger({ source });
  return fields ? logger.with(fields) : logger;
}

export function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause,
    };
  }

  return {
    message: typeof error === "string" ? error : "Unknown error",
  };
}

export async function flushLogger(logger: Logger) {
  await logger.flush().catch(() => undefined);
}

export function getRequestContext(request: Pick<BetterStackRequest, "method" | "url" | "headers">) {
  const url = new URL(request.url);

  return {
    method: request.method,
    path: url.pathname,
    host: url.host,
    userAgent: request.headers.get("user-agent"),
  };
}
