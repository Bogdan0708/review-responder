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

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Verify the cookie's HMAC signature and its issued-at expiry. A cookie that
  // merely exists proves nothing: it is attacker-controlled.
  let session;
  try {
    session = await readSession(request);
  } catch {
    // NEXTAUTH_SECRET is missing, so no session can be verified. Fail closed
    // with a deliberate 503 rather than letting the error surface as a 500.
    return NextResponse.json(
      { error: "Session verification is not configured" },
      { status: 503 }
    );
  }

  if (session) {
    return NextResponse.next();
  }

  if (isApiPath(pathname)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
