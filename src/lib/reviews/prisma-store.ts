import { prisma } from "@/lib/db";
import type {
  ReviewStore,
  StoredReview,
  StoredResponse,
  AuditEntryInput,
} from "./approve";

interface ResponseRow {
  id: string;
  draftText: string;
  finalText: string | null;
  approvedAt: Date | null;
  postedAt: Date | null;
  publishClaimedAt: Date | null;
}

function toStoredResponse(response: ResponseRow): StoredResponse {
  return {
    id: response.id,
    draftText: response.draftText,
    finalText: response.finalText,
    approvedAt: response.approvedAt,
    postedAt: response.postedAt,
    publishClaimedAt: response.publishClaimedAt,
  };
}

/** ReviewStore implemented over the real Prisma client. */
export function createPrismaReviewStore(): ReviewStore {
  return {
    async getReview(id: string): Promise<StoredReview | null> {
      const review = await prisma.review.findUnique({ where: { id } });
      if (!review) return null;
      return { id: review.id, status: review.status };
    },

    async getLatestResponse(reviewId: string): Promise<StoredResponse | null> {
      const response = await prisma.response.findFirst({
        where: { reviewId },
        orderBy: { generatedAt: "desc" },
      });
      if (!response) return null;
      return toStoredResponse(response);
    },

    async getResponse(
      reviewId: string,
      responseId: string
    ): Promise<StoredResponse | null> {
      const response = await prisma.response.findFirst({
        where: { id: responseId, reviewId },
      });
      if (!response) return null;
      return toStoredResponse(response);
    },

    async markApproved(
      reviewId: string,
      responseId: string,
      text: string
    ): Promise<void> {
      await prisma.$transaction([
        prisma.response.update({
          where: { id: responseId },
          data: { approvedAt: new Date(), finalText: text },
        }),
        prisma.review.update({
          where: { id: reviewId },
          data: { status: "approved" },
        }),
      ]);
    },

    async markPosted(reviewId: string, responseId: string): Promise<void> {
      await prisma.$transaction([
        prisma.response.update({
          where: { id: responseId },
          data: { postedAt: new Date() },
        }),
        prisma.review.update({
          where: { id: reviewId },
          data: { status: "posted" },
        }),
      ]);
    },

    /**
     * One conditional UPDATE is the whole concurrency control: the row is only
     * claimed if it is approved, unposted and unclaimed. Postgres serialises
     * the competing updates, so exactly one caller sees count === 1 and goes on
     * to call Google.
     */
    async claimForPublish(
      reviewId: string,
      responseId: string
    ): Promise<boolean> {
      const result = await prisma.response.updateMany({
        where: {
          id: responseId,
          reviewId,
          approvedAt: { not: null },
          postedAt: null,
          publishClaimedAt: null,
        },
        data: { publishClaimedAt: new Date() },
      });
      return result.count === 1;
    },

    async releaseClaim(reviewId: string, responseId: string): Promise<void> {
      await prisma.response.updateMany({
        where: { id: responseId, reviewId, postedAt: null },
        data: { publishClaimedAt: null },
      });
    },

    async writeAudit(entry: AuditEntryInput): Promise<void> {
      await prisma.auditLog.create({
        data: {
          reviewId: entry.reviewId,
          action: entry.action,
          actor: entry.actor,
          details: entry.details ?? undefined,
        },
      });
    },
  };
}
