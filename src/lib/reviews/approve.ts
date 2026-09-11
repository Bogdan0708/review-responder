/**
 * Pure approval + publish invariants for the review-response workflow.
 *
 * This module knows nothing about Prisma or the real Google Business Profile
 * API: it depends only on a small `ReviewStore` port and a `GoogleClient`
 * port, so it can be exercised in unit tests and the local demo with
 * in-memory fakes, and wired to real adapters (`prisma-store.ts`, the real
 * Google reply call in `src/lib/google/respond.ts`) in production.
 *
 * Invariants enforced here:
 *  - only an `owner` or `manager` actor may approve or publish a response
 *  - publishing is idempotent: a response that is already posted is never
 *    posted again, and `google.reply` is not called a second time for it
 *  - a failed `google.reply` never marks the response as posted
 *  - every approval and every publish attempt (success or failure) writes
 *    an audit entry
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
}

export interface AuditEntryInput {
  reviewId: string;
  action: string;
  actor: string;
  details?: unknown;
}

/** Storage port implemented once over Prisma and once in memory (tests/demo). */
export interface ReviewStore {
  getReview(id: string): Promise<StoredReview | null>;
  getLatestResponse(reviewId: string): Promise<StoredResponse | null>;
  markApproved(reviewId: string, responseId: string, text: string): Promise<void>;
  markPosted(reviewId: string, responseId: string): Promise<void>;
  writeAudit(entry: AuditEntryInput): Promise<void>;
}

/** Publishing port implemented once over the real Google Business Profile API and once as a fake. */
export interface GoogleClient {
  reply(reviewId: string, text: string): Promise<{ ok: boolean }>;
}

const PERMITTED_ROLES = new Set(["owner", "manager"]);

export interface ApproveAndPublishInput {
  reviewId: string;
  text: string;
  actor: string;
  /** Only "owner" and "manager" are permitted to approve or publish. */
  role?: string;
  store: ReviewStore;
  /**
   * Optional: when omitted, the response is approved but not published
   * (used by the approve route, which defers publishing to the background
   * job in `src/lib/google/respond.ts`).
   */
  google?: GoogleClient;
}

export interface ApproveAndPublishResult {
  reviewId: string;
  responseId: string;
  approved: true;
  posted: boolean;
  /** True when the response was already posted before this call (no-op publish). */
  alreadyPosted?: boolean;
}

export async function approveAndPublish(
  input: ApproveAndPublishInput
): Promise<ApproveAndPublishResult> {
  const { reviewId, text, actor, role, store, google } = input;

  if (!role || !PERMITTED_ROLES.has(role)) {
    throw new Error(
      `Actor "${actor}" with role "${role ?? "unknown"}" is not permitted to approve or publish responses`
    );
  }

  const review = await store.getReview(reviewId);
  if (!review) {
    throw new Error(`Review ${reviewId} not found`);
  }

  const response = await store.getLatestResponse(reviewId);
  if (!response) {
    throw new Error(`Review ${reviewId} has no response to approve`);
  }

  // Idempotency: never publish twice, and never call google.reply again.
  if (response.postedAt) {
    return {
      reviewId,
      responseId: response.id,
      approved: true,
      posted: true,
      alreadyPosted: true,
    };
  }

  if (!response.approvedAt) {
    await store.markApproved(reviewId, response.id, text);
    await store.writeAudit({
      reviewId,
      action: "response_approved",
      actor,
      details: { responseId: response.id },
    });
  }

  if (!google) {
    return { reviewId, responseId: response.id, approved: true, posted: false };
  }

  let result: { ok: boolean };
  let publishError: unknown = null;
  try {
    result = await google.reply(reviewId, text);
  } catch (err) {
    publishError = err;
    result = { ok: false };
  }

  if (!result.ok) {
    const error = publishError
      ? String(publishError instanceof Error ? publishError.message : publishError)
      : "google.reply returned ok:false";
    await store.writeAudit({
      reviewId,
      action: "response_post_failed",
      actor,
      details: { responseId: response.id, error },
    });
    throw new Error(`Failed to publish response for review ${reviewId} to Google`);
  }

  await store.markPosted(reviewId, response.id);
  await store.writeAudit({
    reviewId,
    action: "response_posted",
    actor,
    details: { responseId: response.id },
  });

  return { reviewId, responseId: response.id, approved: true, posted: true };
}
