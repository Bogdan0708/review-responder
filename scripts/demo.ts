/**
 * npm run demo
 *
 * A self-contained walkthrough of the review-response workflow that needs
 * no accounts, no database, and no network access:
 *
 *   1. Load 5 synthetic reviews for a fictional venue ("The Example Bistro")
 *      from fixtures/reviews.json.
 *   2. Generate a draft reply for each with a stub generator (no LLM calls).
 *   3. Run each draft through approveAndPublish(), backed by an in-memory
 *      store and the FakeGoogle client.
 *   4. Print the approve -> publish trace, including the idempotency check
 *      (approving the same review twice publishes only once) and a
 *      simulated Google outage (one review fails to publish and is not
 *      marked posted).
 */

import { MemoryReviewStore } from "../src/lib/reviews/memory-store";
import { FakeGoogle } from "../src/lib/google/__mocks__/fake-google";
import { approveAndPublish } from "../src/lib/reviews/approve";
import reviews from "../fixtures/reviews.json";

interface DemoReview {
  id: string;
  authorName: string;
  rating: number;
  reviewText: string;
  sentiment: string;
}

/** Stub generator: no network, no API keys — deterministic text for the demo. */
function stubGenerateDraft(review: DemoReview): string {
  const name = review.authorName ?? "there";
  if (review.sentiment === "positive") {
    return `Thank you so much, ${name}! We're thrilled you enjoyed The Example Bistro and hope to see you again soon.`;
  }
  return `Hi ${name}, thank you for the honest feedback — we're sorry we fell short and would love the chance to make it right.`;
}

async function main() {
  console.log("Review Responder — offline demo (synthetic data, no accounts needed)\n");

  const store = new MemoryReviewStore();
  const google = new FakeGoogle();
  const OWNER = { actor: "owner@example.com", role: "owner" as const };

  for (const review of reviews as DemoReview[]) {
    const draft = stubGenerateDraft(review);
    store.seedReview(
      { id: review.id, status: "draft_ready" },
      { id: `resp-${review.id}`, draftText: draft }
    );

    console.log(`Review from ${review.authorName} (${review.rating}★): "${review.reviewText}"`);
    console.log(`  draft: "${draft}"`);

    try {
      const result = await approveAndPublish({
        reviewId: review.id,
        text: draft,
        actor: OWNER.actor,
        role: OWNER.role,
        store,
        google,
      });
      console.log(`  approved + posted (responseId=${result.responseId})`);
    } catch (err) {
      console.log(`  publish failed: ${(err as Error).message}`);
    }
    console.log("");
  }

  console.log("--- Idempotency check: approving review 1 again must not publish twice ---");
  const first = reviews[0] as DemoReview;
  const republishAttempts = await approveAndPublish({
    reviewId: first.id,
    text: "ignored — response is already approved and posted",
    actor: OWNER.actor,
    role: OWNER.role,
    store,
    google,
  });
  console.log(
    `Second approve call for "${first.id}" returned alreadyPosted=${Boolean(
      republishAttempts.alreadyPosted
    )}; google.reply was called for it ${
      google.published.filter((p) => p.id === first.id).length
    } time(s) in total.`
  );

  console.log("\n--- Permission check: a viewer role cannot approve or publish ---");
  try {
    await approveAndPublish({
      reviewId: reviews[1].id,
      text: "irrelevant",
      actor: "intern@example.com",
      role: "viewer",
      store,
      google,
    });
  } catch (err) {
    console.log(`Rejected as expected: ${(err as Error).message}`);
  }

  console.log("\n--- Audit trail ---");
  for (const entry of store.audit) {
    console.log(`  [${entry.createdAt}] ${entry.action} reviewId=${entry.reviewId} actor=${entry.actor}`);
  }

  console.log(`\nDone. ${google.published.length} response(s) published via FakeGoogle.`);
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exitCode = 1;
});
