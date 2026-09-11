import { secretsMatch } from "./secrets";

export {
  COOKIE_NAME,
  SESSION_MAX_AGE,
  createSessionToken,
  currentSessionVersion,
  readSession,
  readSessionToken,
  verifySessionToken,
} from "./session";
export type { Session, SessionRequestLike } from "./session";

/** Constant-time password check against the single owner password. */
export function verifyPassword(input: string): boolean {
  return secretsMatch(input, process.env.AUTH_PASSWORD);
}
