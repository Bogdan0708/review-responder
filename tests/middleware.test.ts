import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";

process.env.NEXTAUTH_SECRET = "test-secret-for-session-tokens";

import { middleware } from "@/middleware";
import { COOKIE_NAME, SESSION_MAX_AGE, createSessionToken } from "@/lib/session";

function request(path: string, cookie?: string, method = "GET") {
  const headers = new Headers();
  if (cookie !== undefined) headers.set("cookie", `${COOKIE_NAME}=${cookie}`);
  return new NextRequest(`http://localhost${path}`, { method, headers });
}

const API_PATH = "/api/reviews/synthetic/approve";

describe("middleware session boundary", () => {
  it("returns 401 JSON for an API request with no session cookie", async () => {
    const res = await middleware(request(API_PATH, undefined, "POST"));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
    await expect(res.json()).resolves.toMatchObject({ error: expect.any(String) });
  });

  it("returns 401 JSON for an API request with a forged cookie", async () => {
    const res = await middleware(request(API_PATH, "whatever", "POST"));
    expect(res.status).toBe(401);
    expect(res.headers.get("x-middleware-next")).toBeNull();
  });

  it("returns 401 JSON for an API request whose signed session has expired", async () => {
    const expired = await createSessionToken(Date.now() - (SESSION_MAX_AGE * 1000 + 60_000));
    const res = await middleware(request(API_PATH, expired, "POST"));
    expect(res.status).toBe(401);
  });

  it("lets an API request with a valid session through", async () => {
    const res = await middleware(request(API_PATH, await createSessionToken(), "POST"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.status).toBe(200);
  });

  it("redirects a page request with no session to /login", async () => {
    const res = await middleware(request("/reviews"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/login");
  });

  it("redirects a page request with a forged cookie to /login", async () => {
    const res = await middleware(request("/reviews", "whatever"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/login");
  });

  it("leaves the public paths reachable without a session", async () => {
    for (const path of ["/login", "/api/auth/login", "/api/webhooks/review", "/api/cron/fetch-google"]) {
      const res = await middleware(request(path, undefined, "POST"));
      expect(res.headers.get("x-middleware-next"), path).toBe("1");
    }
  });
});
