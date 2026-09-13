/** Approval is bound to a version and immutable snapshot. Publication is fenced
 * durably BEFORE I/O. No timeout, crash, or ambiguous result permits auto-retry. */
export interface StoredReview {
  id: string;
  status: string;
}
export interface StoredResponse {
  id: string;
  version: number;
  draftText: string;
  finalText: string | null;
  approvedText: string | null;
  approvedAt: Date | string | null;
  postedAt: Date | string | null;
  publishClaimedAt: Date | string | null;
  publicationToken: string | null;
  publicationState: string;
}
export interface AuditEntryInput {
  reviewId: string;
  action: string;
  actor: string;
  details?: unknown;
}
export interface PublishClaim {
  claimed: boolean;
  token?: string;
}
export class TransitionConflict extends Error {}
export interface ReviewStore {
  getReview(id: string): Promise<StoredReview | null>;
  getLatestResponse(reviewId: string): Promise<StoredResponse | null>;
  getResponse(
    reviewId: string,
    responseId: string,
  ): Promise<StoredResponse | null>;
  markApproved(
    reviewId: string,
    responseId: string,
    text: string,
    version: number,
    actor: string,
  ): Promise<void>;
  markPosted(
    reviewId: string,
    responseId: string,
    token: string,
    actor: string,
  ): Promise<void>;
  claimForPublish(
    reviewId: string,
    responseId: string,
    actor: string,
  ): Promise<PublishClaim>;
  writeAudit(entry: AuditEntryInput): Promise<void>;
}
export interface GoogleClient {
  reply(reviewId: string, text: string): Promise<{ ok: boolean }>;
}
export function approvedTextOf(response: StoredResponse): string {
  if (response.approvedText === null)
    throw new TransitionConflict("Approval snapshot missing; approve again");
  return response.approvedText;
}
export interface ApproveResponseInput {
  reviewId: string;
  responseId: string;
  text: string;
  actor: string;
  role?: string;
  version: number;
  store: ReviewStore;
}
export interface ApproveResponseResult {
  reviewId: string;
  responseId: string;
  approvedText: string;
}
export async function approveResponse(
  input: ApproveResponseInput,
): Promise<ApproveResponseResult> {
  const { reviewId, responseId, text, actor, role, store } = input;
  if (!role || !["owner", "manager"].includes(role))
    throw new Error(
      `Actor "${actor}" with role "${role ?? "unknown"}" is not permitted to approve responses`,
    );
  if (!(await store.getReview(reviewId)))
    throw new Error(`Review ${reviewId} not found`);
  const response = await store.getResponse(reviewId, responseId);
  if (!response)
    throw new Error(`Response ${responseId} not found for review ${reviewId}`);
  if (response.postedAt)
    throw new TransitionConflict("Response has already been published");
  if (response.publishClaimedAt)
    throw new TransitionConflict(
      "Response is being published or requires reconciliation",
    );
  await store.markApproved(reviewId, responseId, text, input.version, actor);
  return { reviewId, responseId, approvedText: text };
}
export interface PublishApprovedInput {
  reviewId: string;
  responseId: string;
  store: ReviewStore;
  google: GoogleClient;
  actor?: string;
}
export interface PublishApprovedResult {
  reviewId: string;
  responseId: string;
  ok: true;
  posted: boolean;
  publishedText?: string;
  alreadyPosted?: boolean;
  alreadyClaimed?: boolean;
}
export async function publishApproved(
  input: PublishApprovedInput,
): Promise<PublishApprovedResult> {
  const { reviewId, responseId, store, google } = input;
  const actor = input.actor ?? "system:publisher";
  const response = await store.getResponse(reviewId, responseId);
  if (!response)
    throw new Error(`Response ${responseId} not found for review ${reviewId}`);
  if (!response.approvedAt)
    throw new Error(`Response ${responseId} is not approved`);
  if (response.postedAt)
    return {
      reviewId,
      responseId,
      ok: true,
      posted: true,
      alreadyPosted: true,
    };
  const claim = await store.claimForPublish(reviewId, responseId, actor);
  if (!claim.claimed || !claim.token)
    return {
      reviewId,
      responseId,
      ok: true,
      posted: false,
      alreadyClaimed: true,
    };
  // The fence and its audit are already committed. Even if the next read fails,
  // no other worker (including another response for this review) may send again.
  const claimed = await store.getResponse(reviewId, responseId);
  if (!claimed?.approvedAt || claimed.publicationToken !== claim.token)
    throw new TransitionConflict("Publication requires manual reconciliation");
  const text = approvedTextOf(claimed);
  try {
    const result = await google.reply(reviewId, text);
    if (!result.ok) throw new Error("google.reply returned ok:false");
  } catch (error) {
    await store.writeAudit({
      reviewId,
      action: "response_post_failed",
      actor,
      details: {
        responseId,
        token: claim.token,
        error: String(error instanceof Error ? error.message : error),
        reconciliationRequired: true,
      },
    });
    throw new Error(
      `Failed to publish response for review ${reviewId}; manual reconciliation required`,
    );
  }
  try {
    await store.markPosted(reviewId, responseId, claim.token, actor);
  } catch (error) {
    await store.writeAudit({
      reviewId,
      action: "response_post_unreconciled",
      actor,
      details: {
        responseId,
        token: claim.token,
        publishedText: text,
        error: String(error instanceof Error ? error.message : error),
      },
    });
    throw new Error(`Response ${responseId} was published but is unreconciled`);
  }
  return { reviewId, responseId, ok: true, posted: true, publishedText: text };
}
