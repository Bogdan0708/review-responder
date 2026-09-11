import { NextResponse } from "next/server";
import { readSession, type Session, type SessionRequestLike } from "./session";

export type SessionGuard =
  | { session: Session; error?: undefined }
  | { session?: undefined; error: NextResponse };

/**
 * Route-handler guard: the verified session, or the response the handler must
 * return. Verifying here as well as in the middleware is deliberate defence in
 * depth — a route must not be reachable just because something upstream let a
 * request through.
 */
export async function requireSession(
  request: SessionRequestLike
): Promise<SessionGuard> {
  let session: Session | null;
  try {
    session = await readSession(request);
  } catch {
    // NEXTAUTH_SECRET missing: fail closed and say so, rather than 500.
    return {
      error: NextResponse.json(
        { error: "Session verification is not configured" },
        { status: 503 }
      ),
    };
  }

  if (!session) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  return { session };
}
