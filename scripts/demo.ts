/**
 * npm run demo
 *
 * A self-contained walkthrough of the review-response workflow that needs
 * no accounts, no database, and no network access:
 *
 *   1. Load 5 synthetic reviews for a fictional venue ("The Example Bistro")
 *      from fixtures/reviews.json.
 *   2. Generate a draft reply for each with a stub generator (no LLM calls).
 *   3. Approve each draft (approveResponse) and then publish the approved
 *      response (publishApproved), backed by an in-memory store and the
 *      FakeGoogle client.
 *   4. Print the approve -> publish trace, including the idempotency check
 *      (publishing the same response twice calls Google once), a concurrency
 *      check (two workers racing on one response both go through
 *      publishApproved and only one reaches Google) and a permission check.
 */

import { MemoryReviewStore } from "../src/lib/reviews/memory-store";
import { FakeGoogle } from "../src/lib/google/__mocks__/fake-google";
import { approveResponse, publishApproved } from "../src/lib/reviews/approve";
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
      const approved = await approveResponse({
        reviewId: review.id,
        responseId: `resp-${review.id}`,
        text: draft,
        actor: OWNER.actor,
        role: OWNER.role,
        store,
      });
      const result = await publishApproved({
        reviewId: review.id,
        responseId: approved.responseId,
        store,
        google,
        actor: OWNER.actor,
      });
      console.log(`  approved + posted (responseId=${result.responseId})`);
    } catch (err) {
      console.log(`  publish failed: ${(err as Error).message}`);
    }
    console.log("");
  }

  console.log("--- Idempotency check: publishing review 1 again must not publish twice ---");
  const first = reviews[0] as DemoReview;
  const republishAttempt = await publishApproved({
    reviewId: first.id,
    responseId: `resp-${first.id}`,
    store,
    google,
    actor: OWNER.actor,
  });
  console.log(
    `Second publish call for "${first.id}" returned alreadyPosted=${Boolean(
      republishAttempt.alreadyPosted
    )}; google.reply was called for it ${
      google.published.filter((p) => p.id === first.id).length
    } time(s) in total.`
  );

  console.log("\n--- Concurrency check: two workers racing to publish one approved response ---");
  const raceStore = new MemoryReviewStore();
  const raceGoogle = new FakeGoogle();
  raceStore.seedReview(
    { id: "race", status: "draft_ready" },
    { id: "resp-race", draftText: "Thanks for the kind words!" }
  );
  await approveResponse({
    reviewId: "race",
    responseId: "resp-race",
    text: "Thanks for the kind words!",
    actor: OWNER.actor,
    role: OWNER.role,
    store: raceStore,
  });
  const raced = await Promise.all([
    publishApproved({ reviewId: "race", responseId: "resp-race", store: raceStore, google: raceGoogle }),
    publishApproved({ reviewId: "race", responseId: "resp-race", store: raceStore, google: raceGoogle }),
  ]);
  console.log(
    `Two concurrent publishes: google.reply called ${raceGoogle.published.length} time(s), ` +
      `${raced.filter((r) => r.alreadyClaimed).length} caller(s) lost the claim, ` +
      `${raceStore.audit.filter((a) => a.action === "response_posted").length} response_posted audit entry.`
  );

  console.log("\n--- Permission check: a viewer role cannot approve ---");
  try {
    await approveResponse({
      reviewId: reviews[1].id,
      responseId: `resp-${reviews[1].id}`,
      text: "irrelevant",
      actor: "intern@example.com",
      role: "viewer",
      store,
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
