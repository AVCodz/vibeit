import { Logger } from "@logtail/next";
import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  const logger = new Logger({ source: "middleware" }).with({
    area: request.nextUrl.pathname.startsWith("/api/") ? "api" : "app",
  });

  await logger.middleware(request, { logRequestDetails: ["nextUrl"] });
  event.waitUntil(logger.flush());

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|_betterstack).*)"],
};
