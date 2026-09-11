/**
 * Approval and publication invariants for the review-response workflow.
 *
 * This module knows nothing about Prisma or the real Google Business Profile
 * API: it depends only on a small `ReviewStore` port and a `GoogleClient`
 * port, so it can be exercised in unit tests and the local demo with
 * in-memory fakes, and wired to real adapters (`prisma-store.ts`, the real
 * Google reply call in `src/lib/google/respond.ts`) in production.
 *
 * Approving and publishing are two separate operations:
 *
 *  - `approveResponse` binds an approval to ONE immutable response id and the
 *    exact text that was approved.
 *  - `publishApproved` publishes that response id's STORED approved text. It
 *    takes no text argument at all, so a caller cannot publish something that
 *    was never approved, and it cannot drift onto a newer (regenerated)
 *    response.
 *
 * Invariants enforced here:
 *  - only an `owner` or `manager` actor may approve a response
 *  - only an approved response may be published, and only its approved text
 *  - publication is claimed atomically (`store.claimForPublish`), so two
 *    concurrent workers produce exactly one `google.reply` call and exactly
 *    one `response_posted` audit entry
 *  - a claim older than `PUBLISH_CLAIM_TTL_MS` (default 15 minutes) is stale —
 *    a process that crashed between claiming and recording the post — and is
 *    reclaimed, with a `response_post_claim_reclaimed` audit entry
 *  - the text is read again AFTER the claim is held, so an edit racing the
 *    claim can never be the thing that gets published unnoticed
 *  - a failed `google.reply` never marks the response posted and always
 *    releases the claim, so a later run can retry
 *  - if Google accepted the reply but the database write then failed, a
 *    `response_post_unreconciled` audit entry names the response id: the
 *    claim is deliberately NOT released (releasing it would risk a duplicate
 *    reply), and the row needs manual reconciliation — see the README.
 *  - every approval and every publish attempt (success or failure) writes an
 *    audit entry
 */

export interface StoredReview {
  id: string;
  status: string;
}

export interface StoredResponse {
  id: string;
  draftText: string;
  finalText: string | null;
  approvedAt: Date | string | null;
  postedAt: Date | string | null;
  /** Set by `claimForPublish`; cleared by `releaseClaim`. */
  publishClaimedAt: Date | string | null;
}

export interface AuditEntryInput {
  reviewId: string;
  action: string;
  actor: string;
  details?: unknown;
}

/** Storage port implemented once over Prisma and once in memory (tests/demo). */
/** Result of an attempt to take the publication claim. */
export interface PublishClaim {
  claimed: boolean;
  /** True when the claim taken over was a stale one left by a crashed run. */
  reclaimed: boolean;
}

/** How long a held-but-unfinished claim stays valid before it can be taken over. */
export const DEFAULT_PUBLISH_CLAIM_TTL_MS = 15 * 60 * 1000;

export function publishClaimTtlMs(): number {
  const raw = process.env.PUBLISH_CLAIM_TTL_MS;
  if (!raw) return DEFAULT_PUBLISH_CLAIM_TTL_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PUBLISH_CLAIM_TTL_MS;
  return parsed;
}

export interface ReviewStore {
  getReview(id: string): Promise<StoredReview | null>;
  /** The most recently generated response — used to pick what to approve. */
  getLatestResponse(reviewId: string): Promise<StoredResponse | null>;
  /** One specific response; the publication path never uses anything else. */
  getResponse(reviewId: string, responseId: string): Promise<StoredResponse | null>;
  markApproved(reviewId: string, responseId: string, text: string): Promise<void>;
  markPosted(reviewId: string, responseId: string): Promise<void>;
  /**
   * Atomically take the right to publish this response. Must be a conditional
   * write (approved, not posted, and either unclaimed or holding a claim older
   * than the TTL) and must report `claimed: true` for exactly one caller.
   */
  claimForPublish(reviewId: string, responseId: string): Promise<PublishClaim>;
  /** Undo an unused claim so a later run can retry. */
  releaseClaim(reviewId: string, responseId: string): Promise<void>;
  writeAudit(entry: AuditEntryInput): Promise<void>;
}

/** Publishing port implemented once over the real Google Business Profile API and once as a fake. */
export interface GoogleClient {
  reply(reviewId: string, text: string): Promise<{ ok: boolean }>;
}

const PERMITTED_ROLES = new Set(["owner", "manager"]);

/** The text a response publishes with: the owner's edit, else the draft. */
export function approvedTextOf(response: StoredResponse): string {
  return response.finalText ?? response.draftText;
}

export interface ApproveResponseInput {
  reviewId: string;
  /** The exact response being approved. Approval never floats to "latest". */
  responseId: string;
  text: string;
  actor: string;
  /** Only "owner" and "manager" are permitted to approve. */
  role?: string;
  store: ReviewStore;
}

export interface ApproveResponseResult {
  reviewId: string;
  responseId: string;
  approvedText: string;
}

export async function approveResponse(
  input: ApproveResponseInput
): Promise<ApproveResponseResult> {
  const { reviewId, responseId, text, actor, role, store } = input;

  if (!role || !PERMITTED_ROLES.has(role)) {
    throw new Error(
      `Actor "${actor}" with role "${role ?? "unknown"}" is not permitted to approve responses`
    );
  }

  const review = await store.getReview(reviewId);
  if (!review) {
    throw new Error(`Review ${reviewId} not found`);
  }

  const response = await store.getResponse(reviewId, responseId);
  if (!response) {
    throw new Error(`Response ${responseId} not found for review ${reviewId}`);
  }
  if (response.postedAt) {
    throw new Error(
      `Response ${responseId} has already been published and cannot be re-approved`
    );
  }
  if (response.publishClaimedAt) {
    // Publication is already under way with the text approved earlier.
    throw new Error(
      `Response ${responseId} is being published and cannot be re-approved`
    );
  }

  await store.markApproved(reviewId, responseId, text);
  await store.writeAudit({
    reviewId,
    action: "response_approved",
    actor,
    details: { responseId, approvedText: text },
  });

  return { reviewId, responseId, approvedText: text };
}

export interface PublishApprovedInput {
  reviewId: string;
  /** The approved response to publish. There is no `text` parameter by design. */
  responseId: string;
  store: ReviewStore;
  google: GoogleClient;
  /** Audit actor; defaults to the background publisher. */
  actor?: string;
}

export interface PublishApprovedResult {
  reviewId: string;
  responseId: string;
  ok: true;
  posted: boolean;
  /** The stored approved text sent to Google, when this call sent it. */
  publishedText?: string;
  /** The response was already posted before this call. */
  alreadyPosted?: boolean;
  /** Another concurrent caller holds the publication claim. */
  alreadyClaimed?: boolean;
}

export async function publishApproved(
  input: PublishApprovedInput
): Promise<PublishApprovedResult> {
  const { reviewId, responseId, store, google } = input;
  const actor = input.actor ?? "system:publisher";

  const response = await store.getResponse(reviewId, responseId);
  if (!response) {
    throw new Error(`Response ${responseId} not found for review ${reviewId}`);
  }
  if (!response.approvedAt) {
    throw new Error(
      `Response ${responseId} of review ${reviewId} is not approved and cannot be published`
    );
  }
  if (response.postedAt) {
    return { reviewId, responseId, ok: true, posted: true, alreadyPosted: true };
  }

  // Atomic claim. Exactly one concurrent caller wins; everyone else stops here
  // without touching Google.
  const claim = await store.claimForPublish(reviewId, responseId);
  if (!claim.claimed) {
    return { reviewId, responseId, ok: true, posted: false, alreadyClaimed: true };
  }

  if (claim.reclaimed) {
    // A previous run died between claiming and recording the post. It may or
    // may not have reached Google, so this is worth an explicit audit trail.
    await store.writeAudit({
      reviewId,
      action: "response_post_claim_reclaimed",
      actor,
      details: { responseId, claimTtlMs: publishClaimTtlMs() },
    });
  }

  // Read the row again now that the claim is HELD: anything that raced the
  // pre-claim read (an edit, an approval being revoked) is visible here, so the
  // text published is the state this call actually owns.
  const claimedResponse = await store.getResponse(reviewId, responseId);
  if (!claimedResponse || !claimedResponse.approvedAt) {
    await store.releaseClaim(reviewId, responseId);
    throw new Error(
      `Response ${responseId} of review ${reviewId} stopped being approved before it could be published`
    );
  }
  if (claimedResponse.postedAt) {
    return { reviewId, responseId, ok: true, posted: true, alreadyPosted: true };
  }

  // Publish what was approved, read from storage — never a caller-supplied text.
  const text = approvedTextOf(claimedResponse);

  let result: { ok: boolean };
  let publishError: unknown = null;
  try {
    result = await google.reply(reviewId, text);
  } catch (err) {
    publishError = err;
    result = { ok: false };
  }

  if (!result.ok) {
    await store.releaseClaim(reviewId, responseId);
    const error = publishError
      ? String(publishError instanceof Error ? publishError.message : publishError)
      : "google.reply returned ok:false";
    await store.writeAudit({
      reviewId,
      action: "response_post_failed",
      actor,
      details: { responseId, error },
    });
    throw new Error(`Failed to publish response for review ${reviewId} to Google`);
  }

  try {
    await store.markPosted(reviewId, responseId);
  } catch (err) {
    // Google has the reply but the database does not know it. The claim stays
    // held on purpose: releasing it would let a later run reply a second time.
    const error = String(err instanceof Error ? err.message : err);
    await store.writeAudit({
      reviewId,
      action: "response_post_unreconciled",
      actor,
      details: { responseId, publishedText: text, error },
    });
    throw new Error(
      `Response ${responseId} of review ${reviewId} was published to Google but could not be marked posted (unreconciled): ${error}`
    );
  }

  await store.writeAudit({
    reviewId,
    action: "response_posted",
    actor,
    details: { responseId },
  });

  return { reviewId, responseId, ok: true, posted: true, publishedText: text };
}
