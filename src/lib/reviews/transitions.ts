import { prisma } from "@/lib/db";
import { TransitionConflict } from "./approve";
import { requireMutableReview } from "./prisma-store";
export async function editDraft(
  reviewId: string,
  id: string,
  text: string,
  version: number,
  actor: string,
) {
  await prisma.$transaction(async (tx) => {
    await requireMutableReview(tx, reviewId);
    const result = await tx.response.updateMany({
      where: {
        id,
        reviewId,
        version,
        approvedAt: null,
        postedAt: null,
        publishClaimedAt: null,
        publicationState: "idle",
      },
      data: { finalText: text, version: { increment: 1 } },
    });
    if (result.count !== 1)
      throw new TransitionConflict(
        "Response changed, is approved, or has already been published; refresh",
      );
    await tx.auditLog.create({
      data: {
        reviewId,
        action: "response_edited",
        actor,
        details: { responseId: id, version },
      },
    });
  });
}
export async function rejectReview(reviewId: string, actor: string) {
  await prisma.$transaction(async (tx) => {
    await requireMutableReview(tx, reviewId);
    await tx.response.updateMany({
      where: {
        reviewId,
        postedAt: null,
        publishClaimedAt: null,
        publicationState: "idle",
      },
      data: { approvedAt: null, approvedText: null, version: { increment: 1 } },
    });
    await tx.review.update({
      where: { id: reviewId },
      data: { status: "rejected" },
    });
    await tx.auditLog.create({
      data: { reviewId, action: "response_rejected", actor },
    });
  });
}
export async function saveRegeneratedDraft(
  reviewId: string,
  expectedReviewVersion: number,
  result: { text: string; model: string; tokensUsed: number },
  actor: string,
  action: "draft_generated" | "draft_regenerated" = "draft_regenerated",
) {
  return prisma.$transaction(async (tx) => {
    const review = await requireMutableReview(tx, reviewId);
    // lockReview increments the version; generation happened outside the lock.
    if (review.version !== expectedReviewVersion + 1)
      throw new TransitionConflict("Review changed while generating; refresh");
    await tx.response.updateMany({
      where: {
        reviewId,
        postedAt: null,
        publishClaimedAt: null,
        publicationState: "idle",
      },
      data: { approvedAt: null, approvedText: null, version: { increment: 1 } },
    });
    const response = await tx.response.create({
      data: {
        reviewId,
        draftText: result.text,
        llmModel: result.model,
        llmTokensUsed: result.tokensUsed,
      },
    });
    await tx.review.update({
      where: { id: reviewId },
      data: { status: "draft_ready" },
    });
    await tx.auditLog.create({
      data: {
        reviewId,
        action,
        actor,
        details: { responseId: response.id, model: result.model },
      },
    });
    return response;
  });
}
