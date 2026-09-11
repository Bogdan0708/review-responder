import { NextRequest, NextResponse } from "next/server";
import { readSession } from "@/lib/session";

/**
 * Paths reachable without a dashboard session. `/api/webhooks` and `/api/cron`
 * are not unauthenticated: they carry their own shared-secret headers
 * (`x-webhook-secret` / `Authorization: Bearer $CRON_SECRET`), enforced in
 * those route handlers, because the callers are machines and not browsers.
 */
const PUBLIC_PATHS = ["/login", "/api/auth", "/api/webhooks", "/api/cron"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Verify the cookie's HMAC signature and its issued-at expiry. A cookie that
  // merely exists proves nothing: it is attacker-controlled.
  const session = await readSession(request);
  if (session) {
    return NextResponse.next();
  }

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
