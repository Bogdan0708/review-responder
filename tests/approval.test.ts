import { describe, it, expect } from "vitest";
import { MemoryReviewStore } from "../src/lib/reviews/memory-store";
import { FakeGoogle } from "../src/lib/google/__mocks__/fake-google";
import { approveResponse, publishApproved } from "../src/lib/reviews/approve";

function seededStore(): MemoryReviewStore {
  const store = new MemoryReviewStore();
  store.seedReview(
    { id: "r1", status: "draft_ready" },
    { id: "resp-r1", draftText: "Thanks!" },
  );
  store.seedReview(
    { id: "r2", status: "draft_ready" },
    { id: "resp-r2", draftText: "Appreciate the feedback." },
  );
  store.seedReview(
    { id: "r3", status: "draft_ready" },
    { id: "resp-r3", draftText: "Sorry to hear that." },
  );
  return store;
}

const OWNER = { actor: "owner@example.com", role: "owner" } as const;

describe("approveResponse", () => {
  it("binds the approval to one response id and its exact text", async () => {
    const store = seededStore();

    const result = await approveResponse({
      version: 0,
      reviewId: "r1",
      responseId: "resp-r1",
      text: "Thanks so much!",
      ...OWNER,
      store,
    });

    expect(result).toEqual({
      reviewId: "r1",
      responseId: "resp-r1",
      approvedText: "Thanks so much!",
    });
    const response = await store.getResponse("r1", "resp-r1");
    expect(response?.approvedAt).not.toBeNull();
    expect(response?.finalText).toBe("Thanks so much!");
    expect(response?.postedAt).toBeNull();
    expect(
      store.audit.some(
        (a) => a.reviewId === "r1" && a.action === "response_approved",
      ),
    ).toBe(true);
  });

  it("refuses to approve without an owner/manager role", async () => {
    const store = seededStore();

    await expect(
      approveResponse({
      version: 0,
        reviewId: "r2",
        responseId: "resp-r2",
        text: "x",
        actor: "stranger",
        role: "viewer",
        store,
      }),
    ).rejects.toThrow(/not permitted/);

    expect((await store.getResponse("r2", "resp-r2"))?.approvedAt).toBeNull();
  });

  it("refuses to approve a response that belongs to another review", async () => {
    const store = seededStore();

    await expect(
      approveResponse({
      version: 0,
        reviewId: "r2",
        responseId: "resp-r3",
        text: "x",
        ...OWNER,
        store,
      }),
    ).rejects.toThrow(/not found/);
  });

  it("refuses to re-approve a response that has already been published", async () => {
    const store = seededStore();
    await approveResponse({
      version: 0,
      reviewId: "r1",
      responseId: "resp-r1",
      text: "Thanks!",
      ...OWNER,
      store,
    });
    await publishApproved({
      reviewId: "r1",
      responseId: "resp-r1",
      store,
      google: new FakeGoogle(),
    });

    await expect(
      approveResponse({
      version: 0,
        reviewId: "r1",
        responseId: "resp-r1",
        text: "Different text",
        ...OWNER,
        store,
      }),
    ).rejects.toThrow(/already been published/);
  });
});

describe("approveResponse + publishApproved together", () => {
  it("publishes exactly once when the same response is published twice in a row", async () => {
    const store = seededStore();
    const g = new FakeGoogle();

    await approveResponse({
      version: 0,
      reviewId: "r1",
      responseId: "resp-r1",
      text: "Thanks!",
      ...OWNER,
      store,
    });
    await publishApproved({
      reviewId: "r1",
      responseId: "resp-r1",
      store,
      google: g,
    });
    await publishApproved({
      reviewId: "r1",
      responseId: "resp-r1",
      store,
      google: g,
    });

    expect(g.published.filter((p) => p.id === "r1")).toHaveLength(1);
  });

  it("publishes the approved text, not a newer regenerated draft", async () => {
    const store = seededStore();
    const g = new FakeGoogle();

    await approveResponse({
      version: 0,
      reviewId: "r1",
      responseId: "resp-r1",
      text: "Thanks!",
      ...OWNER,
      store,
    });
    store.addResponse("r1", {
      id: "resp-r1b",
      draftText: "Regenerated, never approved",
    });

    await publishApproved({
      reviewId: "r1",
      responseId: "resp-r1",
      store,
      google: g,
    });

    expect(g.published).toEqual([{ id: "r1", text: "Thanks!" }]);
  });

  it("does not mark the response posted when google.reply fails, and records the failure", async () => {
    const store = seededStore();
    const g = new FakeGoogle();
    g.failNext("r3");

    await approveResponse({
      version: 0,
      reviewId: "r3",
      responseId: "resp-r3",
      text: "Sorry to hear that.",
      ...OWNER,
      store,
    });
    await expect(
      publishApproved({
        reviewId: "r3",
        responseId: "resp-r3",
        store,
        google: g,
      }),
    ).rejects.toThrow(/Failed to publish/);

    const response = await store.getResponse("r3", "resp-r3");
    expect(response?.postedAt).toBeNull();
    expect(response?.publishClaimedAt).not.toBeNull();
    const failureEntry = store.audit.find(
      (a) => a.reviewId === "r3" && a.action === "response_post_failed",
    );
    expect(failureEntry?.details).toMatchObject({
      responseId: "resp-r3",
      error: expect.any(String),
    });
  });

  it("captures the thrown error's message in the audit detail when google.reply throws", async () => {
    const store = seededStore();
    const google = {
      async reply(): Promise<{ ok: boolean }> {
        throw new Error("Google API 503: temporarily unavailable");
      },
    };

    await approveResponse({
      version: 0,
      reviewId: "r3",
      responseId: "resp-r3",
      text: "Sorry to hear that.",
      ...OWNER,
      store,
    });
    await expect(
      publishApproved({ reviewId: "r3", responseId: "resp-r3", store, google }),
    ).rejects.toThrow(/Failed to publish/);

    const failureEntry = store.audit.find(
      (a) => a.reviewId === "r3" && a.action === "response_post_failed",
    );
    expect(failureEntry?.details).toMatchObject({
      responseId: "resp-r3",
      error: "Google API 503: temporarily unavailable",
    });
  });

  it("writes an audit entry for both the approval and the publish", async () => {
    const store = seededStore();
    const g = new FakeGoogle();

    await approveResponse({
      version: 0,
      reviewId: "r1",
      responseId: "resp-r1",
      text: "Thanks!",
      actor: "manager@example.com",
      role: "manager",
      store,
    });
    await publishApproved({
      reviewId: "r1",
      responseId: "resp-r1",
      store,
      google: g,
      actor: "manager@example.com",
    });

    expect(
      store.audit.some(
        (a) => a.reviewId === "r1" && a.action === "response_approved",
      ),
    ).toBe(true);
    expect(
      store.audit.some(
        (a) => a.reviewId === "r1" && a.action === "response_posted",
      ),
    ).toBe(true);
  });

  it("approves without publishing: nothing reaches Google until publishApproved runs", async () => {
    const store = seededStore();
    const g = new FakeGoogle();

    await approveResponse({
      version: 0,
      reviewId: "r2",
      responseId: "resp-r2",
      text: "Appreciate the feedback.",
      ...OWNER,
      store,
    });

    const response = await store.getResponse("r2", "resp-r2");
    expect(response?.approvedAt).not.toBeNull();
    expect(response?.postedAt).toBeNull();
    expect(g.published).toHaveLength(0);
  });
});
