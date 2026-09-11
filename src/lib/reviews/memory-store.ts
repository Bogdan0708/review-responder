import type {
  ReviewStore,
  StoredReview,
  StoredResponse,
  AuditEntryInput,
} from "./approve";

export interface SeedResponseInput {
  id: string;
  draftText: string;
  finalText?: string | null;
  approvedAt?: string | null;
  postedAt?: string | null;
  publishClaimedAt?: string | null;
}

export interface AuditRecord extends AuditEntryInput {
  createdAt: string;
}

/**
 * In-memory implementation of ReviewStore, used by unit tests and by
 * `npm run demo`. Keeps responses per review in insertion order; the
 * "latest" response is the last one seeded/created for that review.
 */
export class MemoryReviewStore implements ReviewStore {
  private reviews = new Map<string, StoredReview>();
  private responses = new Map<string, StoredResponse[]>();
  readonly audit: AuditRecord[] = [];

  seedReview(review: StoredReview, response?: SeedResponseInput): void {
    this.reviews.set(review.id, { ...review });
    if (response) this.addResponse(review.id, response);
  }

  /** Append a newer response, as regeneration does in production. */
  addResponse(reviewId: string, response: SeedResponseInput): void {
    const list = this.responses.get(reviewId) ?? [];
    list.push({
      id: response.id,
      draftText: response.draftText,
      finalText: response.finalText ?? null,
      approvedAt: response.approvedAt ?? null,
      postedAt: response.postedAt ?? null,
      publishClaimedAt: response.publishClaimedAt ?? null,
    });
    this.responses.set(reviewId, list);
  }

  async getReview(id: string): Promise<StoredReview | null> {
    return this.reviews.get(id) ?? null;
  }

  async getLatestResponse(reviewId: string): Promise<StoredResponse | null> {
    const list = this.responses.get(reviewId);
    if (!list || list.length === 0) return null;
    return list[list.length - 1];
  }

  async getResponse(
    reviewId: string,
    responseId: string
  ): Promise<StoredResponse | null> {
    return this.findResponse(reviewId, responseId) ?? null;
  }

  async markApproved(
    reviewId: string,
    responseId: string,
    text: string
  ): Promise<void> {
    const review = this.reviews.get(reviewId);
    if (review) review.status = "approved";
    const response = this.findResponse(reviewId, responseId);
    if (response) {
      response.approvedAt = new Date().toISOString();
      response.finalText = text;
    }
  }

  async markPosted(reviewId: string, responseId: string): Promise<void> {
    const review = this.reviews.get(reviewId);
    if (review) review.status = "posted";
    const response = this.findResponse(reviewId, responseId);
    if (response) {
      response.postedAt = new Date().toISOString();
    }
  }

  /**
   * Same semantics as the Prisma `updateMany` claim: approved, not posted,
   * not already claimed. The check and the write happen with no `await`
   * between them, so concurrent callers on the single-threaded event loop see
   * the same all-or-nothing behaviour as the conditional SQL UPDATE.
   */
  async claimForPublish(reviewId: string, responseId: string): Promise<boolean> {
    const response = this.findResponse(reviewId, responseId);
    if (!response) return false;
    if (!response.approvedAt) return false;
    if (response.postedAt) return false;
    if (response.publishClaimedAt) return false;
    response.publishClaimedAt = new Date().toISOString();
    return true;
  }

  async releaseClaim(reviewId: string, responseId: string): Promise<void> {
    const response = this.findResponse(reviewId, responseId);
    if (response && !response.postedAt) response.publishClaimedAt = null;
  }

  async writeAudit(entry: AuditEntryInput): Promise<void> {
    this.audit.push({ ...entry, createdAt: new Date().toISOString() });
  }

  private findResponse(
    reviewId: string,
    responseId: string
  ): StoredResponse | undefined {
    return this.responses.get(reviewId)?.find((r) => r.id === responseId);
  }
}
