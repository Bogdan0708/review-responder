import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

process.env.NEXTAUTH_SECRET = "test-secret-for-session-tokens";

import { createFakePrisma } from "./helpers/fake-prisma";
import { COOKIE_NAME, createSessionToken } from "@/lib/session";

const fakePrisma = createFakePrisma();
vi.mock("@/lib/db", () => ({ prisma: fakePrisma }));
vi.mock("@/lib/google/auth", () => ({
  getAccessToken: vi.fn(async () => "fake-token"),
  clearTokenCache: vi.fn(),
}));
vi.mock("@/lib/webhooks/notify", () => ({
  notifyWebhook: vi.fn(async () => undefined),
}));

async function approve(cookie: string) {
  const { POST } = await import("@/app/api/reviews/[id]/approve/route");
  return POST(req(cookie, "http://localhost/api/reviews/r1/approve"), {
    params: Promise.resolve({ id: "r1" }),
  });
}

async function editResponse(cookie: string, text: string) {
  const { PUT } = await import("@/app/api/reviews/[id]/response/route");
  return PUT(
    new NextRequest("http://localhost/api/reviews/r1/response", {
      method: "PUT",
      headers: new Headers({
        cookie: `${COOKIE_NAME}=${cookie}`,
        "content-type": "application/json",
      }),
      body: JSON.stringify({
        responseId: "resp-1",
        text,
        version: fakePrisma.responses[0].version ?? 0,
      }),
    }),
    { params: Promise.resolve({ id: "r1" }) },
  );
}

async function reject(cookie: string) {
  const { POST } = await import("@/app/api/reviews/[id]/reject/route");
  return POST(req(cookie, "http://localhost/api/reviews/r1/reject"), {
    params: Promise.resolve({ id: "r1" }),
  });
}

function req(cookie: string, url: string) {
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify({
      responseId: "resp-1",
      version: fakePrisma.responses[0].version ?? 0,
    }),
    headers: new Headers({ cookie: `${COOKIE_NAME}=${cookie}` }),
  });
}

describe("approved text is immutable until the review is rejected", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.GOOGLE_ACCOUNT_ID = "acct";
    process.env.GOOGLE_LOCATION_ID = "loc";
    fakePrisma.reviews = [
      {
        id: "r1",
        platform: "google",
        status: "draft_ready",
        externalId: "ext-1",
        authorName: "Ana",
      },
    ];
    fakePrisma.responses = [
      {
        id: "resp-1",
        reviewId: "r1",
        draftText: "Draft text",
        finalText: "Text the owner approved",
        generatedAt: new Date("2026-01-01T09:00:00Z"),
        approvedAt: null,
        postedAt: null,
        publishClaimedAt: null,
      },
    ];
    fakePrisma.auditEntries = [];
    fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("approve -> edit is refused with 409, and the cron publishes the approved text", async () => {
    const cookie = await createSessionToken();

    expect((await approve(cookie)).status).toBe(200);

    const edit = await editResponse(
      cookie,
      "Sneaky text that was never approved",
    );
    expect(edit.status).toBe(409);
    await expect(edit.json()).resolves.toMatchObject({
      error: expect.stringMatching(/approved/i),
    });
    expect(fakePrisma.responses[0].finalText).toBe("Text the owner approved");

    const { postPendingGoogleResponses } = await import("@/lib/google/respond");
    const result = await postPendingGoogleResponses();

    expect(result).toMatchObject({ posted: 1, failed: 0 });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      comment: "Text the owner approved",
    });
  });

  it("allows editing again once the review is rejected, which clears the approval", async () => {
    const cookie = await createSessionToken();

    expect((await approve(cookie)).status).toBe(200);
    expect((await editResponse(cookie, "nope")).status).toBe(409);

    expect((await reject(cookie)).status).toBe(200);
    expect(fakePrisma.responses[0].approvedAt).toBeNull();

    const edit = await editResponse(cookie, "A reworked draft");
    expect(edit.status).toBe(200);
    expect(fakePrisma.responses[0].finalText).toBe("A reworked draft");

    // A rejected (unapproved) response is not publishable.
    const { postPendingGoogleResponses } = await import("@/lib/google/respond");
    expect(await postPendingGoogleResponses()).toMatchObject({
      posted: 0,
      failed: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to edit a response that has already been published", async () => {
    const cookie = await createSessionToken();
    fakePrisma.responses[0].approvedAt = new Date("2026-01-01T10:00:00Z");
    fakePrisma.responses[0].postedAt = new Date("2026-01-01T11:00:00Z");

    const edit = await editResponse(cookie, "too late");
    expect(edit.status).toBe(409);
    await expect(edit.json()).resolves.toMatchObject({
      error: expect.stringMatching(/published/i),
    });
  });
});
