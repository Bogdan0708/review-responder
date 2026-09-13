import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { TransitionConflict, type ReviewStore } from "./approve";
type Tx = Prisma.TransactionClient;
// All transitions acquire the parent row first. PostgreSQL holds its UPDATE
// lock until commit, serializing even transitions on different response IDs.
export async function lockReview(tx: Tx, reviewId: string) {
  return tx.review.update({
    where: { id: reviewId },
    data: { version: { increment: 1 } },
  });
}
export async function requireMutableReview(tx: Tx, reviewId: string) {
  const review = await lockReview(tx, reviewId);
  if (
    ["posted", "reconciliation"].includes(review.status) ||
    (await tx.response.findFirst({
      where: {
        reviewId,
        OR: [{ postedAt: { not: null } }, { publishClaimedAt: { not: null } }],
      },
    }))
  )
    throw new TransitionConflict(
      "Review is published or requires manual reconciliation",
    );
  return review;
}
export function createPrismaReviewStore(client = prisma): ReviewStore {
  return {
    getReview: (id) => client.review.findUnique({ where: { id } }),
    getLatestResponse: (reviewId) =>
      client.response.findFirst({
        where: { reviewId },
        orderBy: { generatedAt: "desc" },
      }),
    getResponse: (reviewId, id) =>
      client.response.findFirst({ where: { id, reviewId } }),
    async markApproved(reviewId, id, text, version, actor) {
      await client.$transaction(async (tx) => {
        await requireMutableReview(tx, reviewId);
        const latest = await tx.response.findFirst({
          where: { reviewId },
          orderBy: [{ generatedAt: "desc" }, { id: "desc" }],
        });
        if (latest?.id !== id)
          throw new TransitionConflict(
            "Draft changed; refresh before approving",
          );
        const changed = await tx.response.updateMany({
          where: {
            id,
            reviewId,
            version,
            approvedAt: null,
            postedAt: null,
            publishClaimedAt: null,
            publicationState: "idle",
          },
          data: {
            approvedAt: new Date(),
            approvedText: text,
            finalText: text,
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1)
          throw new TransitionConflict(
            "Response changed or is already approved; refresh",
          );
        await tx.review.update({
          where: { id: reviewId },
          data: { status: "approved" },
        });
        await tx.auditLog.create({
          data: {
            reviewId,
            action: "response_approved",
            actor,
            details: { responseId: id, approvedText: text, version },
          },
        });
      });
    },
    async claimForPublish(reviewId, id, actor) {
      return client.$transaction(async (tx) => {
        const review = await lockReview(tx, reviewId);
        if (review.status !== "approved") return { claimed: false };
        if (
          await tx.response.findFirst({
            where: {
              reviewId,
              OR: [
                { postedAt: { not: null } },
                { publishClaimedAt: { not: null } },
              ],
            },
          })
        )
          return { claimed: false };
        const token = randomUUID();
        const changed = await tx.response.updateMany({
          where: {
            id,
            reviewId,
            approvedAt: { not: null },
            approvedText: { not: null },
            postedAt: null,
            publishClaimedAt: null,
            publicationState: "idle",
          },
          data: {
            publishClaimedAt: new Date(),
            publicationToken: token,
            publicationState: "reconciliation",
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1) return { claimed: false };
        await tx.review.update({
          where: { id: reviewId },
          data: { status: "reconciliation" },
        });
        await tx.auditLog.create({
          data: {
            reviewId,
            action: "response_post_attempt_started",
            actor,
            details: { responseId: id, token },
          },
        });
        return { claimed: true, token };
      });
    },
    async markPosted(reviewId, id, token, actor) {
      await client.$transaction(async (tx) => {
        await lockReview(tx, reviewId);
        const changed = await tx.response.updateMany({
          where: {
            id,
            reviewId,
            publicationToken: token,
            publicationState: "reconciliation",
            postedAt: null,
          },
          data: {
            postedAt: new Date(),
            publicationState: "posted",
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1)
          throw new TransitionConflict("Publication token is no longer valid");
        await tx.review.update({
          where: { id: reviewId },
          data: { status: "posted" },
        });
        await tx.auditLog.create({
          data: {
            reviewId,
            action: "response_posted",
            actor,
            details: { responseId: id, token },
          },
        });
      });
    },
    async writeAudit(entry) {
      await client.auditLog.create({
        data: {
          ...entry,
          details: entry.details as Prisma.InputJsonValue | undefined,
        },
      });
    },
  };
}
