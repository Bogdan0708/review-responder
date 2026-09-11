import { describe, it, expect } from "vitest";
import { MemoryReviewStore } from "../src/lib/reviews/memory-store";
import { FakeGoogle } from "../src/lib/google/__mocks__/fake-google";
import { approveAndPublish } from "../src/lib/reviews/approve";
import reviews from "../fixtures/reviews.json";

/**
 * Mirrors the loop in src/lib/google/respond.ts: postPendingGoogleResponses
 * approves-and-publishes each already-approved, not-yet-posted review and
 * counts successes/failures without letting one failure block the batch.
 */
describe("publishing a batch of approved reviews", () => {
  it("posts every already-approved review and counts a mid-batch failure without blocking the rest", async () => {
    const store = new MemoryReviewStore();
    const now = new Date().toISOString();
    for (const review of reviews) {
      store.seedReview(
        { id: review.id, status: "approved" },
        { id: `resp-${review.id}`, draftText: `Thanks, ${review.authorName}!`, approvedAt: now }
      );
    }

    const g = new FakeGoogle();
    g.failNext(reviews[2].id);

    let posted = 0;
    let failed = 0;

    for (const review of reviews) {
      try {
        await approveAndPublish({
          reviewId: review.id,
          text: `Thanks, ${review.authorName}!`,
          actor: "system:cron",
          role: "manager",
          store,
          google: g,
        });
        posted++;
      } catch {
        failed++;
      }
    }

    expect(posted).toBe(reviews.length - 1);
    expect(failed).toBe(1);
    expect(g.published).toHaveLength(reviews.length - 1);
  });

  it("never re-publishes a review a previous batch already posted", async () => {
    const store = new MemoryReviewStore();
    const now = new Date().toISOString();
    store.seedReview(
      { id: "r1", status: "posted" },
      { id: "resp-r1", draftText: "Thanks!", approvedAt: now, postedAt: now }
    );
    const g = new FakeGoogle();

    await approveAndPublish({ reviewId: "r1", text: "Thanks!", actor: "system:cron", role: "manager", store, google: g });

    expect(g.published).toHaveLength(0);
  });
});
