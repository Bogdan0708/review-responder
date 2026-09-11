/**
 * Session tokens for the single-owner dashboard.
 *
 * This module is deliberately Edge-safe: it uses only Web Crypto
 * (`crypto.subtle`), no `node:crypto` and no `next/headers`, so the Next.js
 * middleware (which runs on the Edge runtime) can verify a session with the
 * same code the route handlers use. `src/lib/auth.ts` re-exports everything
 * here and adds the server-component helper that needs `next/headers`.
 *
 * Token format: `<base64url(JSON payload)>.<hex HMAC-SHA256 of the payload>`.
 * The payload carries an issued-at timestamp, so expiry is enforced
 * server-side rather than relying on the browser honouring the cookie's
 * Max-Age. Tokens issued by the previous format (a bare `Date.now()` string)
 * no longer parse and are rejected — the only effect is that existing
 * sessions have to log in again.
 */

export const COOKIE_NAME = "auth_session";
/** Seconds. Enforced both on the cookie (Max-Age) and on the token payload. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

/** Tolerance for a token minted on a machine whose clock runs slightly ahead. */
const CLOCK_SKEW_MS = 60_000;

const PAYLOAD_VERSION = 1;

export interface Session {
  /**
   * The deployment is single-owner (one shared password), so a valid session
   * is always the owner. The actor is derived from the session here and never
   * taken from the request body or hard-coded in a route handler.
   */
  actor: "owner";
  role: "owner";
  /** Epoch milliseconds the token was issued at. */
  issuedAt: number;
}

interface SessionPayload {
  v: number;
  iat: number;
}

/** Anything with a cookie jar: `NextRequest`, or a plain object in tests. */
export interface SessionRequestLike {
  cookies: { get(name: string): { value: string } | undefined };
}

function getSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET not configured");
  return secret;
}

const encoder = new TextEncoder();

function base64UrlEncode(value: string): string {
  const bytes = encoder.encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): string | null {
  try {
    const padded =
      value.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (value.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const bytes = new Uint8Array(signature);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

/** Length-independent comparison of two hex strings (no early return on mismatch). */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** `issuedAt` is injectable so tests can mint expired / future-dated tokens. */
export async function createSessionToken(issuedAt: number = Date.now()): Promise<string> {
  const payload = base64UrlEncode(
    JSON.stringify({ v: PAYLOAD_VERSION, iat: issuedAt } satisfies SessionPayload)
  );
  return `${payload}.${await sign(payload)}`;
}

/**
 * Verify signature AND expiry, and return the session it represents.
 * Returns null for anything that is missing, malformed, forged or expired.
 */
export async function readSessionToken(
  token: string | null | undefined,
  now: number = Date.now()
): Promise<Session | null> {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (!payload || !signature) return null;

  if (!constantTimeEquals(signature, await sign(payload))) return null;

  const json = base64UrlDecode(payload);
  if (json === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const { v, iat } = parsed as Partial<SessionPayload>;
  if (v !== PAYLOAD_VERSION) return null;
  if (typeof iat !== "number" || !Number.isFinite(iat)) return null;
  if (iat > now + CLOCK_SKEW_MS) return null;
  if (iat + SESSION_MAX_AGE * 1000 <= now) return null;

  return { actor: "owner", role: "owner", issuedAt: iat };
}

export async function verifySessionToken(
  token: string | null | undefined,
  now: number = Date.now()
): Promise<boolean> {
  return (await readSessionToken(token, now)) !== null;
}

/** Read and verify the session cookie off a request (middleware + route handlers). */
export async function readSession(
  request: SessionRequestLike,
  now: number = Date.now()
): Promise<Session | null> {
  return readSessionToken(request.cookies.get(COOKIE_NAME)?.value, now);
}
