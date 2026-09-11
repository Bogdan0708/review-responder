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
    if (response) {
      const list = this.responses.get(review.id) ?? [];
      list.push({
        id: response.id,
        draftText: response.draftText,
        finalText: response.finalText ?? null,
        approvedAt: response.approvedAt ?? null,
        postedAt: response.postedAt ?? null,
      });
      this.responses.set(review.id, list);
    }
  }

  async getReview(id: string): Promise<StoredReview | null> {
    return this.reviews.get(id) ?? null;
  }

  async getLatestResponse(reviewId: string): Promise<StoredResponse | null> {
    const list = this.responses.get(reviewId);
    if (!list || list.length === 0) return null;
    return list[list.length - 1];
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
