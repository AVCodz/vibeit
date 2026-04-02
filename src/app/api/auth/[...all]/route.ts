import { withBetterStack, type BetterStackRequest } from "@logtail/next";
import { auth } from "@/lib/auth";
import { getRequestContext, serializeError } from "@/lib/better-stack";
import { toNextJsHandler } from "better-auth/next-js";

const authHandlers = toNextJsHandler(auth);

function resolveAuthAction(request: BetterStackRequest) {
  const pathname = request.nextUrl?.pathname ?? new URL(request.url).pathname;
  const authPath = pathname.replace(/^\/api\/auth\/?/, "");
  return authPath.length > 0 ? authPath : "root";
}

export const GET = withBetterStack(async (request: BetterStackRequest) => {
  const startedAt = Date.now();
  const action = resolveAuthAction(request);
  const requestContext = getRequestContext(request);
  const log = request.log.with({ route: "auth", action, ...requestContext });

  try {
    const response = await authHandlers.GET(request);

    log.info("Auth request completed", {
      outcome: response.status >= 400 ? "failure" : "success",
      statusCode: response.status,
      durationMs: Date.now() - startedAt,
    });

    return response;
  } catch (error) {
    log.error("Auth request failed", {
      outcome: "error",
      durationMs: Date.now() - startedAt,
      ...serializeError(error),
    });
    throw error;
  }
});

export const POST = withBetterStack(async (request: BetterStackRequest) => {
  const startedAt = Date.now();
  const action = resolveAuthAction(request);
  const requestContext = getRequestContext(request);
  const log = request.log.with({ route: "auth", action, ...requestContext });

  try {
    const response = await authHandlers.POST(request);

    if (response.status >= 400) {
      log.warn("Auth request completed", {
        outcome: "failure",
        statusCode: response.status,
        durationMs: Date.now() - startedAt,
      });
    } else {
      log.info("Auth request completed", {
        outcome: "success",
        statusCode: response.status,
        durationMs: Date.now() - startedAt,
      });
    }

    return response;
  } catch (error) {
    log.error("Auth request failed", {
      outcome: "error",
      durationMs: Date.now() - startedAt,
      ...serializeError(error),
    });

    throw error;
  }
});
