import { cookies } from "next/headers";

export {
  COOKIE_NAME,
  SESSION_MAX_AGE,
  createSessionToken,
  readSession,
  readSessionToken,
  verifySessionToken,
} from "./session";
export type { Session, SessionRequestLike } from "./session";

import { COOKIE_NAME, readSessionToken, type Session } from "./session";

export function verifyPassword(input: string): boolean {
  const password = process.env.AUTH_PASSWORD;
  if (!password) return false;
  return input === password;
}

/**
 * Server-component helper: the verified session for the current request, or
 * null. Uses `next/headers`, so it is not usable from the Edge middleware —
 * middleware imports `readSession` from `./session` instead.
 */
export async function getCurrentSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  return readSessionToken(cookieStore.get(COOKIE_NAME)?.value);
}

export async function getSession(): Promise<boolean> {
  return (await getCurrentSession()) !== null;
}
