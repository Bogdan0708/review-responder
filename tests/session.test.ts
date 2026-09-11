import { describe, it, expect } from "vitest";

process.env.NEXTAUTH_SECRET = "test-secret-for-session-tokens";

import {
  COOKIE_NAME,
  SESSION_MAX_AGE,
  createSessionToken,
  readSession,
  readSessionToken,
  verifySessionToken,
} from "@/lib/session";

function requestWithCookie(value?: string) {
  return {
    cookies: {
      get(name: string) {
        if (name !== COOKIE_NAME || value === undefined) return undefined;
        return { value };
      },
    },
  };
}

describe("session tokens", () => {
  it("accepts a freshly issued token and exposes the owner session", async () => {
    const token = await createSessionToken();
    const session = await readSessionToken(token);
    expect(session).not.toBeNull();
    expect(session?.actor).toBe("owner");
    expect(session?.role).toBe("owner");
    expect(await verifySessionToken(token)).toBe(true);
  });

  it("rejects an arbitrary unsigned cookie value", async () => {
    expect(await verifySessionToken("arbitrary-unsigned-cookie")).toBe(false);
    expect(await readSessionToken("arbitrary-unsigned-cookie")).toBeNull();
  });

  it("rejects a token whose payload was tampered with after signing", async () => {
    const token = await createSessionToken();
    const [payload, signature] = token.split(".");
    const forged = await createSessionToken(Date.now() - 1000);
    const [otherPayload] = forged.split(".");
    expect(otherPayload).not.toBe(payload);
    expect(await verifySessionToken(`${otherPayload}.${signature}`)).toBe(false);
  });

  it("rejects a legacy bare-timestamp token with a bogus signature", async () => {
    expect(await verifySessionToken(`${Date.now()}.deadbeef`)).toBe(false);
  });

  it("rejects a correctly signed token that is past SESSION_MAX_AGE", async () => {
    const expired = await createSessionToken(Date.now() - (SESSION_MAX_AGE * 1000 + 60_000));
    expect(await verifySessionToken(expired)).toBe(false);
    expect(await readSessionToken(expired)).toBeNull();
  });

  it("accepts a signed token one minute before it expires", async () => {
    const nearlyExpired = await createSessionToken(Date.now() - (SESSION_MAX_AGE * 1000 - 60_000));
    expect(await verifySessionToken(nearlyExpired)).toBe(true);
  });

  it("rejects a token issued far in the future", async () => {
    const future = await createSessionToken(Date.now() + 10 * 60_000);
    expect(await verifySessionToken(future)).toBe(false);
  });

  it("rejects a token issued under an earlier SESSION_VERSION", async () => {
    const previous = process.env.SESSION_VERSION;
    try {
      process.env.SESSION_VERSION = "7";
      const token = await createSessionToken();
      expect(await verifySessionToken(token)).toBe(true);

      // Bumping the version is the server-side revocation lever: every token
      // issued under the old value stops verifying immediately.
      process.env.SESSION_VERSION = "8";
      expect(await verifySessionToken(token)).toBe(false);
      expect(await readSessionToken(token)).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.SESSION_VERSION;
      else process.env.SESSION_VERSION = previous;
    }
  });

  it("readSession reads the session cookie off a request", async () => {
    expect(await readSession(requestWithCookie())).toBeNull();
    expect(await readSession(requestWithCookie("nonsense"))).toBeNull();
    expect(await readSession(requestWithCookie(await createSessionToken()))).toMatchObject({
      actor: "owner",
      role: "owner",
    });
  });
});
