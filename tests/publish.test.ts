import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryReviewStore } from "../src/lib/reviews/memory-store";
import { FakeGoogle } from "../src/lib/google/__mocks__/fake-google";
import { approveResponse, publishApproved } from "../src/lib/reviews/approve";
import { createFakePrisma, type FakePrisma } from "./helpers/fake-prisma";

const fakePrisma = createFakePrisma();
vi.mock("@/lib/db", () => ({ prisma: fakePrisma }));
vi.mock("../db", () => ({ prisma: fakePrisma }));
vi.mock("@/lib/webhooks/notify", () => ({ notifyWebhook: vi.fn(async () => undefined) }));
vi.mock("../webhooks/notify", () => ({ notifyWebhook: vi.fn(async () => undefined) }));
vi.mock("@/lib/google/auth", () => ({
  getAccessToken: vi.fn(async () => "fake-token"),
  clearTokenCache: vi.fn(),
}));
vi.mock("./auth", () => ({
  getAccessToken: vi.fn(async () => "fake-token"),
  clearTokenCache: vi.fn(),
}));

function approvedStore(text = "Approved text"): MemoryReviewStore {
  const store = new MemoryReviewStore();
  const now = new Date().toISOString();
  store.seedReview(
    { id: "r1", status: "approved" },
    { id: "resp-1", draftText: "Draft text", finalText: text, approvedAt: now }
  );
  return store;
}

describe("publishApproved — publication invariants", () => {
  it("calls google.reply exactly once and audits once when two workers publish concurrently", async () => {
    const store = approvedStore();
    let calls = 0;
    let release!: () => void;
    const barrier = new Promise<void>((r) => {
      release = r;
    });
    const google = {
      async reply(_id: string, _text: string) {
        calls++;
        release();
        await barrier;
        return { ok: true };
      },
    };

    const results = await Promise.all([
      publishApproved({ reviewId: "r1", responseId: "resp-1", store, google }),
      publishApproved({ reviewId: "r1", responseId: "resp-1", store, google }),
    ]);

    expect(calls).toBe(1);
    expect(store.audit.filter((a) => a.action === "response_posted")).toHaveLength(1);
    expect(results.filter((r) => r.posted)).toHaveLength(1);
    expect(results.filter((r) => r.alreadyClaimed)).toHaveLength(1);
  });

  it("publishes the approved response's stored text, not a caller-supplied text", async () => {
    const store = approvedStore("Approved text");
    const google = new FakeGoogle();

    // A caller-supplied text has nowhere to go: publishApproved takes no text.
    const result = await publishApproved({ reviewId: "r1", responseId: "resp-1", store, google });

    expect(result.publishedText).toBe("Approved text");
    expect(google.published).toEqual([{ id: "r1", text: "Approved text" }]);
  });

  it("publishes the approved response even after a newer draft is regenerated", async () => {
    const store = approvedStore("Approved text");
    store.addResponse("r1", { id: "resp-2", draftText: "Regenerated draft, never approved" });
    expect((await store.getLatestResponse("r1"))?.id).toBe("resp-2");

    const google = new FakeGoogle();
    const result = await publishApproved({ reviewId: "r1", responseId: "resp-1", store, google });

    expect(result.responseId).toBe("resp-1");
    expect(google.published).toEqual([{ id: "r1", text: "Approved text" }]);
    expect((await store.getResponse("r1", "resp-2"))?.postedAt).toBeNull();
  });

  it("refuses to publish a response that was never approved", async () => {
    const store = new MemoryReviewStore();
    store.seedReview({ id: "r1", status: "draft_ready" }, { id: "resp-1", draftText: "Draft" });
    const google = new FakeGoogle();

    await expect(
      publishApproved({ reviewId: "r1", responseId: "resp-1", store, google })
    ).rejects.toThrow(/not approved/);
    expect(google.published).toHaveLength(0);
  });

  it("leaves postedAt null and releases the claim when google.reply fails", async () => {
    const store = approvedStore();
    const google = new FakeGoogle();
    google.failNext("r1");

    await expect(
      publishApproved({ reviewId: "r1", responseId: "resp-1", store, google })
    ).rejects.toThrow(/Failed to publish/);

    const response = await store.getResponse("r1", "resp-1");
    expect(response?.postedAt).toBeNull();
    expect(response?.publishClaimedAt).toBeNull();
    expect(store.audit.some((a) => a.action === "response_post_failed")).toBe(true);

    // The released claim means a later retry can publish.
    await publishApproved({ reviewId: "r1", responseId: "resp-1", store, google });
    expect(google.published).toHaveLength(1);
  });

  it("audits response_post_unreconciled when Google succeeded but the database write failed", async () => {
    const store = approvedStore();
    vi.spyOn(store, "markPosted").mockRejectedValueOnce(new Error("connection terminated"));
    const google = new FakeGoogle();

    await expect(
      publishApproved({ reviewId: "r1", responseId: "resp-1", store, google })
    ).rejects.toThrow(/unreconciled/i);

    const entry = store.audit.find((a) => a.action === "response_post_unreconciled");
    expect(entry).toBeDefined();
    expect(entry?.details).toMatchObject({ responseId: "resp-1", error: "connection terminated" });
    expect(google.published).toHaveLength(1);
    expect(store.audit.some((a) => a.action === "response_posted")).toBe(false);
  });

  it("never calls google again for a response that is already posted", async () => {
    const store = approvedStore();
    const google = new FakeGoogle();
    await publishApproved({ reviewId: "r1", responseId: "resp-1", store, google });
    const second = await publishApproved({ reviewId: "r1", responseId: "resp-1", store, google });

    expect(second.alreadyPosted).toBe(true);
    expect(google.published).toHaveLength(1);
  });
});

describe("postPendingGoogleResponses — the real worker over a mocked Prisma", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.GOOGLE_ACCOUNT_ID = "acct";
    process.env.GOOGLE_LOCATION_ID = "loc";
    fakePrisma.reviews = [];
    fakePrisma.responses = [];
    fakePrisma.auditEntries = [];
    fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("publishes the pinned approved response for each approved review and skips posted ones", async () => {
    const { postPendingGoogleResponses } = await import("../src/lib/google/respond");

    fakePrisma.reviews = [
      { id: "r1", platform: "google", status: "approved", externalId: "ext-1", authorName: "Ana" },
      { id: "r2", platform: "google", status: "approved", externalId: "ext-2", authorName: "Ben" },
      { id: "r3", platform: "tripadvisor", status: "approved", externalId: "ext-3", authorName: "Cy" },
    ];
    fakePrisma.responses = [
      {
        id: "resp-1a",
        reviewId: "r1",
        draftText: "Draft 1",
        finalText: "Approved reply for r1",
        generatedAt: new Date("2026-01-01T10:00:00Z"),
        approvedAt: new Date("2026-01-01T11:00:00Z"),
        postedAt: null,
        publishClaimedAt: null,
      },
      {
        // Regenerated AFTER approval: newer, unapproved — must not be published.
        id: "resp-1b",
        reviewId: "r1",
        draftText: "Regenerated draft for r1",
        finalText: null,
        generatedAt: new Date("2026-01-02T10:00:00Z"),
        approvedAt: null,
        postedAt: null,
        publishClaimedAt: null,
      },
      {
        // Already posted — the selection must not pick it up again.
        id: "resp-2a",
        reviewId: "r2",
        draftText: "Draft 2",
        finalText: "Already posted reply",
        generatedAt: new Date("2026-01-01T10:00:00Z"),
        approvedAt: new Date("2026-01-01T11:00:00Z"),
        postedAt: new Date("2026-01-01T12:00:00Z"),
        publishClaimedAt: new Date("2026-01-01T12:00:00Z"),
      },
      {
        // Non-google platform — must not be selected.
        id: "resp-3a",
        reviewId: "r3",
        draftText: "Draft 3",
        finalText: "Tripadvisor reply",
        generatedAt: new Date("2026-01-01T10:00:00Z"),
        approvedAt: new Date("2026-01-01T11:00:00Z"),
        postedAt: null,
        publishClaimedAt: null,
      },
    ];

    const result = await postPendingGoogleResponses();

    expect(result).toMatchObject({ posted: 1, failed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/reviews/ext-1/reply");
    expect(JSON.parse(String(init.body))).toEqual({ comment: "Approved reply for r1" });

    const posted = fakePrisma.responses.find((r) => r.id === "resp-1a");
    expect(posted?.postedAt).not.toBeNull();
    expect(fakePrisma.responses.find((r) => r.id === "resp-1b")?.postedAt).toBeNull();
    expect(fakePrisma.auditEntries.some((a) => a.action === "response_posted")).toBe(true);
  });

  it("counts a failing review without blocking the rest of the batch and releases its claim", async () => {
    const { postPendingGoogleResponses } = await import("../src/lib/google/respond");

    fakePrisma.reviews = [
      { id: "r1", platform: "google", status: "approved", externalId: "ext-1", authorName: "Ana" },
      { id: "r2", platform: "google", status: "approved", externalId: "ext-2", authorName: "Ben" },
    ];
    fakePrisma.responses = [
      {
        id: "resp-1a",
        reviewId: "r1",
        draftText: "Draft 1",
        finalText: "Approved reply for r1",
        generatedAt: new Date("2026-01-01T10:00:00Z"),
        approvedAt: new Date("2026-01-01T11:00:00Z"),
        postedAt: null,
        publishClaimedAt: null,
      },
      {
        id: "resp-2a",
        reviewId: "r2",
        draftText: "Draft 2",
        finalText: "Approved reply for r2",
        generatedAt: new Date("2026-01-01T10:00:00Z"),
        approvedAt: new Date("2026-01-01T11:00:00Z"),
        postedAt: null,
        publishClaimedAt: null,
      },
    ];

    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("ext-1")
        ? new Response("boom", { status: 500 })
        : new Response("{}", { status: 200 })
    );

    const result = await postPendingGoogleResponses();

    expect(result).toMatchObject({ posted: 1, failed: 1 });
    const failedRow = fakePrisma.responses.find((r) => r.id === "resp-1a");
    expect(failedRow?.postedAt).toBeNull();
    expect(failedRow?.publishClaimedAt).toBeNull();
    expect(fakePrisma.responses.find((r) => r.id === "resp-2a")?.postedAt).not.toBeNull();
  }, 20_000);
});
