import { prisma } from "../db";
import { withRetry } from "../config/retry";
import { notifyWebhook } from "../webhooks/notify";
import { getAccessToken, clearTokenCache } from "./auth";
import { approveAndPublish } from "../reviews/approve";
import { createPrismaReviewStore } from "../reviews/prisma-store";

const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";

function getGoogleLocationName(): string {
  const accountId = process.env.GOOGLE_ACCOUNT_ID;
  const locationId = process.env.GOOGLE_LOCATION_ID;

  if (!accountId || !locationId) {
    throw new Error(
      "Missing GOOGLE_ACCOUNT_ID or GOOGLE_LOCATION_ID in environment."
    );
  }

  return `accounts/${accountId}/locations/${locationId}`;
}

async function postReplyToGoogle(
  googleReviewId: string,
  replyText: string
): Promise<void> {
  const locationName = getGoogleLocationName();
  const url = `${GBP_API_BASE}/${locationName}/reviews/${googleReviewId}/reply`;

  const response = await withRetry(async () => {
    const token = await getAccessToken();
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ comment: replyText }),
    });

    if (res.status === 401) {
      clearTokenCache();
      throw new Error("Google API returned 401 — token may be expired");
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Google reply API error (${res.status}): ${body}`);
    }

    return res;
  });
}

/** Post approved responses for all Google reviews that haven't been posted yet. */
export async function postPendingGoogleResponses(): Promise<{
  posted: number;
  failed: number;
}> {
  const approvedReviews = await prisma.review.findMany({
    where: {
      platform: "google",
      status: "approved",
    },
    include: {
      responses: {
        where: { approvedAt: { not: null }, postedAt: null },
        orderBy: { generatedAt: "desc" },
        take: 1,
      },
    },
  });

  const store = createPrismaReviewStore();
  let posted = 0;
  let failed = 0;

  for (const review of approvedReviews) {
    const response = review.responses[0];
    if (!response) continue;

    const replyText = response.finalText ?? response.draftText;

    try {
      await approveAndPublish({
        reviewId: review.id,
        text: replyText,
        actor: "system:cron",
        role: "manager",
        store,
        google: {
          async reply(_reviewId: string, text: string) {
            try {
              await postReplyToGoogle(review.externalId, text);
              return { ok: true };
            } catch (err) {
              console.error(
                `Failed to post response for review ${review.id}:`,
                err
              );
              return { ok: false };
            }
          },
        },
      });

      notifyWebhook("response_posted", {
        reviewId: review.id,
        platform: "google",
        authorName: review.authorName ?? "Anonymous",
      });

      posted++;
    } catch (err) {
      console.error(
        `Failed to post response for review ${review.id}:`,
        err
      );

      failed++;
    }
  }

  return { posted, failed };
}
