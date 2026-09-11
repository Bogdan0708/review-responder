import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

import { createFakePrisma } from "./helpers/fake-prisma";

const fakePrisma = createFakePrisma();
vi.mock("@/lib/db", () => ({ prisma: fakePrisma }));

const work = vi.hoisted(() => ({
  deleted: 0,
  fetched: vi.fn(async () => ({ created: 0, duplicates: 0 })),
  posted: vi.fn(async () => ({ posted: 0, failed: 0, skipped: 0 })),
  ingested: vi.fn(async () => ({ status: "created" as const, reviewId: "rev-1" })),
}));

vi.mock("@/lib/google/reviews", () => ({ fetchGoogleReviews: work.fetched }));
vi.mock("@/lib/google/respond", () => ({ postPendingGoogleResponses: work.posted }));
vi.mock("@/lib/reviews/ingest", () => ({ ingestReview: work.ingested }));

function post(url: string, headers: Record<string, string> = {}, body?: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: new Headers(headers),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const VALID_REVIEW = {
  platform: "google",
  externalId: "ext-1",
  rating: 5,
  reviewText: "Lovely place",
};

describe("machine endpoints are guarded by their own shared secrets", () => {
  beforeEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.WEBHOOK_SECRET;
    fakePrisma.auditEntries = [];
    vi.clearAllMocks();
  });

  describe.each([
    ["/api/cron/cleanup", "@/app/api/cron/cleanup/route"],
    ["/api/cron/fetch-google", "@/app/api/cron/fetch-google/route"],
  ])("%s", (path, modulePath) => {
    async function call(headers: Record<string, string> = {}) {
      const { POST } = await import(modulePath);
      return POST(post(`http://localhost${path}`, headers));
    }

    it("returns 503 when CRON_SECRET is not configured", async () => {
      const res = await call({ authorization: "Bearer anything" });
      expect(res.status).toBe(503);
      await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/CRON_SECRET/) });
      expect(work.fetched).not.toHaveBeenCalled();
      expect(work.posted).not.toHaveBeenCalled();
    });

    it("returns 401 for a missing or wrong secret", async () => {
      process.env.CRON_SECRET = "right-secret";

      expect((await call()).status).toBe(401);
      expect((await call({ authorization: "Bearer wrong-secret" })).status).toBe(401);
      expect((await call({ authorization: "right-secret" })).status).toBe(401);
      expect(work.fetched).not.toHaveBeenCalled();
      expect(work.posted).not.toHaveBeenCalled();
    });

    it("proceeds with the correct secret", async () => {
      process.env.CRON_SECRET = "right-secret";
      const res = await call({ authorization: "Bearer right-secret" });
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({ success: true });
    });
  });

  describe("/api/webhooks/review", () => {
    async function call(headers: Record<string, string> = {}) {
      const { POST } = await import("@/app/api/webhooks/review/route");
      return POST(
        post("http://localhost/api/webhooks/review", { "content-type": "application/json", ...headers }, VALID_REVIEW)
      );
    }

    it("returns 503 when WEBHOOK_SECRET is not configured", async () => {
      const res = await call({ "x-webhook-secret": "anything" });
      expect(res.status).toBe(503);
      await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/WEBHOOK_SECRET/) });
      expect(work.ingested).not.toHaveBeenCalled();
    });

    it("returns 401 for a missing or wrong secret", async () => {
      process.env.WEBHOOK_SECRET = "right-secret";

      expect((await call()).status).toBe(401);
      expect((await call({ "x-webhook-secret": "wrong-secret" })).status).toBe(401);
      expect(work.ingested).not.toHaveBeenCalled();
    });

    it("ingests with the correct secret", async () => {
      process.env.WEBHOOK_SECRET = "right-secret";
      const res = await call({ "x-webhook-secret": "right-secret" });
      expect(res.status).toBe(201);
      expect(work.ingested).toHaveBeenCalledTimes(1);
    });
  });
});
