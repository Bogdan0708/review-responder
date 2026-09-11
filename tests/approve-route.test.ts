import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

process.env.NEXTAUTH_SECRET = "test-secret-for-session-tokens";

import { createFakePrisma } from "./helpers/fake-prisma";
import { COOKIE_NAME, SESSION_MAX_AGE, createSessionToken } from "@/lib/session";

const fakePrisma = createFakePrisma();
vi.mock("@/lib/db", () => ({ prisma: fakePrisma }));

const replies: { externalId: string; text: string }[] = [];
vi.mock("@/lib/google/respond", () => ({
  createGoogleReplyClient: (externalId: string) => ({
    async reply(_reviewId: string, text: string) {
      replies.push({ externalId, text });
      return { ok: true };
    },
  }),
}));

/** Imported lazily so the vi.mock factories see the initialised fakes. */
async function POST(...args: Parameters<typeof import("@/app/api/reviews/[id]/approve/route").POST>) {
  const route = await import("@/app/api/reviews/[id]/approve/route");
  return route.POST(...args);
}

function request(cookie?: string, query = "") {
  const headers = new Headers();
  if (cookie !== undefined) headers.set("cookie", `${COOKIE_NAME}=${cookie}`);
  return new NextRequest(`http://localhost/api/reviews/r1/approve${query}`, {
    method: "POST",
    headers,
  });
}

const params = { params: Promise.resolve({ id: "r1" }) };

function seed() {
  fakePrisma.reviews = [
    { id: "r1", platform: "google", status: "draft_ready", externalId: "ext-1", authorName: "Ana" },
  ];
  fakePrisma.responses = [
    {
      id: "resp-old",
      reviewId: "r1",
      draftText: "Older draft",
      finalText: null,
      generatedAt: new Date("2026-01-01T09:00:00Z"),
      approvedAt: null,
      postedAt: null,
      publishClaimedAt: null,
    },
    {
      id: "resp-new",
      reviewId: "r1",
      draftText: "Newest draft",
      finalText: "Owner-edited reply",
      generatedAt: new Date("2026-01-02T09:00:00Z"),
      approvedAt: null,
      postedAt: null,
      publishClaimedAt: null,
    },
  ];
  fakePrisma.auditEntries = [];
  replies.length = 0;
}

describe("POST /api/reviews/[id]/approve — session boundary", () => {
  beforeEach(() => {
    seed();
    vi.clearAllMocks();
  });

  it("returns 401 JSON without a session cookie and touches no data", async () => {
    const res = await POST(request(), { params: Promise.resolve({ id: "r1" }) });
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: expect.any(String) });
    expect(fakePrisma.review.findUnique).not.toHaveBeenCalled();
    expect(fakePrisma.responses.every((r) => r.approvedAt === null)).toBe(true);
  });

  it("returns 401 for a forged cookie", async () => {
    const res = await POST(request("whatever"), { params: Promise.resolve({ id: "r1" }) });
    expect(res.status).toBe(401);
    expect(fakePrisma.responses.every((r) => r.approvedAt === null)).toBe(true);
  });

  it("returns 401 for a correctly signed but expired session", async () => {
    const expired = await createSessionToken(Date.now() - (SESSION_MAX_AGE * 1000 + 60_000));
    const res = await POST(request(expired), { params: Promise.resolve({ id: "r1" }) });
    expect(res.status).toBe(401);
    expect(fakePrisma.responses.every((r) => r.approvedAt === null)).toBe(true);
  });

  it("approves the latest response with the actor derived from the session", async () => {
    const res = await POST(request(await createSessionToken()), params);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ responseId: "resp-new" });

    const approved = fakePrisma.responses.find((r) => r.id === "resp-new");
    expect(approved?.approvedAt).not.toBeNull();
    expect(approved?.finalText).toBe("Owner-edited reply");
    expect(fakePrisma.responses.find((r) => r.id === "resp-old")?.approvedAt).toBeNull();

    const audit = fakePrisma.auditEntries.find((a) => a.action === "response_approved");
    expect(audit).toMatchObject({ actor: "owner", reviewId: "r1" });
  });

  it("publishes the approved text when ?publish=1 is requested", async () => {
    const res = await POST(request(await createSessionToken(), "?publish=1"), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ posted: true, responseId: "resp-new" });
    expect(replies).toEqual([{ externalId: "ext-1", text: "Owner-edited reply" }]);
    expect(fakePrisma.responses.find((r) => r.id === "resp-new")?.postedAt).not.toBeNull();
  });
});
