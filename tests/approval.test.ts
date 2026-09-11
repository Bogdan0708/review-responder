import { describe, it, expect } from "vitest";
import { MemoryReviewStore } from "../src/lib/reviews/memory-store";
import { FakeGoogle } from "../src/lib/google/__mocks__/fake-google";
import { approveAndPublish } from "../src/lib/reviews/approve";

function seededStore(): MemoryReviewStore {
  const store = new MemoryReviewStore();
  store.seedReview({ id: "r1", status: "draft_ready" }, { id: "resp-r1", draftText: "Thanks!" });
  store.seedReview({ id: "r2", status: "draft_ready" }, { id: "resp-r2", draftText: "Appreciate the feedback." });
  store.seedReview({ id: "r3", status: "draft_ready" }, { id: "resp-r3", draftText: "Sorry to hear that." });
  return store;
}

describe("approveAndPublish", () => {
  it("publishes exactly once even when approved twice", async () => {
    const store = seededStore();
    const g = new FakeGoogle();

    await approveAndPublish({ reviewId: "r1", text: "Thanks!", actor: "owner@example.com", role: "owner", store, google: g });
    await approveAndPublish({ reviewId: "r1", text: "Thanks!", actor: "owner@example.com", role: "owner", store, google: g });

    expect(g.published.filter((p) => p.id === "r1")).toHaveLength(1);
  });

  it("refuses to approve or publish without an owner/manager role", async () => {
    const store = seededStore();
    const g = new FakeGoogle();

    await expect(
      approveAndPublish({ reviewId: "r2", text: "x", actor: "stranger", role: "viewer", store, google: g })
    ).rejects.toThrow(/not permitted/);

    expect(g.published).toHaveLength(0);
  });

  it("does not mark the response posted when google.reply fails, and records the failure", async () => {
    const store = seededStore();
    const g = new FakeGoogle();
    g.failNext("r3");

    await expect(
      approveAndPublish({ reviewId: "r3", text: "Sorry to hear that.", actor: "owner@example.com", role: "owner", store, google: g })
    ).rejects.toThrow(/Failed to publish/);

    const response = await store.getLatestResponse("r3");
    expect(response?.postedAt).toBeNull();
    expect(
      store.audit.some((a) => a.reviewId === "r3" && a.action === "response_post_failed")
    ).toBe(true);
  });

  it("writes an audit entry for both the approval and the publish", async () => {
    const store = seededStore();
    const g = new FakeGoogle();

    await approveAndPublish({ reviewId: "r1", text: "Thanks!", actor: "owner@example.com", role: "manager", store, google: g });

    expect(store.audit.some((a) => a.reviewId === "r1" && a.action === "response_approved")).toBe(true);
    expect(store.audit.some((a) => a.reviewId === "r1" && a.action === "response_posted")).toBe(true);
  });

  it("approves without publishing when no google client is supplied", async () => {
    const store = seededStore();

    const result = await approveAndPublish({
      reviewId: "r2",
      text: "Appreciate the feedback.",
      actor: "owner@example.com",
      role: "owner",
      store,
    });

    expect(result.posted).toBe(false);
    const response = await store.getLatestResponse("r2");
    expect(response?.approvedAt).not.toBeNull();
    expect(response?.postedAt).toBeNull();
  });
});
