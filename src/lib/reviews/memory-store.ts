import { randomUUID } from "node:crypto";
import {
  TransitionConflict,
  type ReviewStore,
  type StoredReview,
  type StoredResponse,
  type AuditEntryInput,
  type PublishClaim,
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
export class MemoryReviewStore implements ReviewStore {
  private reviews = new Map<string, StoredReview>();
  private responses = new Map<string, StoredResponse[]>();
  readonly audit: AuditRecord[] = [];
  seedReview(review: StoredReview, response?: SeedResponseInput) {
    this.reviews.set(review.id, { ...review });
    if (response) this.addResponse(review.id, response);
  }
  addResponse(reviewId: string, response: SeedResponseInput) {
    const list = this.responses.get(reviewId) ?? [];
    list.push({
      id: response.id,
      draftText: response.draftText,
      finalText: response.finalText ?? null,
      approvedAt: response.approvedAt ?? null,
      postedAt: response.postedAt ?? null,
      publishClaimedAt: response.publishClaimedAt ?? null,
      version: 0,
      approvedText: response.approvedAt
        ? (response.finalText ?? response.draftText)
        : null,
      publicationState: response.publishClaimedAt ? "reconciliation" : "idle",
      publicationToken: null,
    });
    this.responses.set(reviewId, list);
  }
  async getReview(id: string) {
    const review = this.reviews.get(id);
    return review ? { ...review } : null;
  }
  async getLatestResponse(id: string) {
    const r = this.responses.get(id)?.at(-1);
    return r ? { ...r } : null;
  }
  async getResponse(id: string, rid: string) {
    const r = this.find(id, rid);
    return r ? { ...r } : null;
  }
  patchResponse(
    id: string,
    rid: string,
    patch: Partial<Omit<StoredResponse, "id">>,
  ) {
    const r = this.find(id, rid);
    if (r) Object.assign(r, patch);
  }
  async markApproved(
    id: string,
    rid: string,
    text: string,
    version: number,
    actor: string,
  ) {
    const r = this.find(id, rid);
    if (
      !r ||
      r.version !== version ||
      r.approvedAt ||
      r.publishClaimedAt ||
      r.postedAt ||
      this.responses.get(id)?.at(-1)?.id !== rid ||
      this.responses
        .get(id)
        ?.some((response) => response.postedAt || response.publishClaimedAt)
    )
      throw new TransitionConflict("Response changed or already approved");
    r.approvedAt = new Date().toISOString();
    r.approvedText = text;
    r.finalText = text;
    r.version++;
    this.reviews.get(id)!.status = "approved";
    await this.writeAudit({
      reviewId: id,
      action: "response_approved",
      actor,
      details: { responseId: rid, approvedText: text, version },
    });
  }
  async claimForPublish(
    id: string,
    rid: string,
    actor: string,
  ): Promise<PublishClaim> {
    const r = this.find(id, rid);
    if (
      !r ||
      !r.approvedAt ||
      r.approvedText === null ||
      this.reviews.get(id)?.status !== "approved" ||
      this.responses.get(id)?.some((s) => s.postedAt || s.publishClaimedAt)
    )
      return { claimed: false };
    const token = randomUUID();
    r.publicationToken = token;
    r.publishClaimedAt = new Date().toISOString();
    r.publicationState = "reconciliation";
    this.reviews.get(id)!.status = "reconciliation";
    await this.writeAudit({
      reviewId: id,
      action: "response_post_attempt_started",
      actor,
      details: { responseId: rid, token },
    });
    return { claimed: true, token };
  }
  async markPosted(id: string, rid: string, token: string, actor: string) {
    const r = this.find(id, rid);
    if (
      !r ||
      r.publicationToken !== token ||
      r.publicationState !== "reconciliation"
    )
      throw new TransitionConflict("Invalid publication token");
    r.postedAt = new Date().toISOString();
    r.publicationState = "posted";
    this.reviews.get(id)!.status = "posted";
    await this.writeAudit({
      reviewId: id,
      action: "response_posted",
      actor,
      details: { responseId: rid, token },
    });
  }
  async writeAudit(entry: AuditEntryInput) {
    this.audit.push({ ...entry, createdAt: new Date().toISOString() });
  }
  private find(id: string, rid: string) {
    return this.responses.get(id)?.find((r) => r.id === rid);
  }
}
