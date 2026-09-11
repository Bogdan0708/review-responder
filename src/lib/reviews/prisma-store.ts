import { prisma } from "@/lib/db";
import type {
  ReviewStore,
  StoredReview,
  StoredResponse,
  AuditEntryInput,
} from "./approve";

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
      return {
        id: response.id,
        draftText: response.draftText,
        finalText: response.finalText,
        approvedAt: response.approvedAt,
        postedAt: response.postedAt,
      };
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
