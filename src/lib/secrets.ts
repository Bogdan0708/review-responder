import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison of two secrets (shared secrets, passwords).
 *
 * Node-only — the Edge middleware never calls this; it verifies HMAC
 * signatures through `src/lib/session.ts` instead. Lengths are compared first
 * because `timingSafeEqual` throws on unequal-length buffers; that leaks the
 * length of the expected secret and nothing else.
 */
export function secretsMatch(
  provided: string | null | undefined,
  expected: string | null | undefined
): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
