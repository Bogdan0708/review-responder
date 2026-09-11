import { prisma } from "../db";
import { withRetry } from "../config/retry";
import { notifyWebhook } from "../webhooks/notify";
import { getAccessToken, clearTokenCache } from "./auth";
import { publishApproved, type GoogleClient } from "../reviews/approve";
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

  await withRetry(async () => {
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

/**
 * The real `GoogleClient` for one review. The text always comes from
 * `publishApproved` (the stored approved text), never from the caller.
 */
export function createGoogleReplyClient(externalReviewId: string): GoogleClient {
  return {
    async reply(reviewId: string, text: string) {
      try {
        await postReplyToGoogle(externalReviewId, text);
        return { ok: true };
      } catch (err) {
        console.error(`Failed to post response for review ${reviewId}:`, err);
        return { ok: false };
      }
    },
  };
}

/**
 * Post approved responses for all Google reviews that haven't been posted yet.
 *
 * The selection produces explicit `{ reviewId, responseId }` pairs and those
 * ids are what gets published: if a newer draft is regenerated between the
 * query and the publish, the approved response is still the one that goes to
 * Google. The publication claim (`publishApproved`) makes overlapping runs of
 * this worker safe.
 */
export async function postPendingGoogleResponses(): Promise<{
  posted: number;
  failed: number;
  skipped: number;
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

  const targets = approvedReviews.flatMap((review) => {
    const response = review.responses[0];
    if (!response) return [];
    return [
      {
        reviewId: review.id,
        responseId: response.id,
        externalId: review.externalId,
        authorName: review.authorName,
      },
    ];
  });

  const store = createPrismaReviewStore();
  let posted = 0;
  let failed = 0;
  let skipped = 0;

  for (const target of targets) {
    try {
      const result = await publishApproved({
        reviewId: target.reviewId,
        responseId: target.responseId,
        actor: "system:cron",
        store,
        google: createGoogleReplyClient(target.externalId),
      });

      if (result.publishedText === undefined) {
        // Already posted, or another worker holds the claim.
        skipped++;
        continue;
      }

      notifyWebhook("response_posted", {
        reviewId: target.reviewId,
        platform: "google",
        authorName: target.authorName ?? "Anonymous",
      });

      posted++;
    } catch (err) {
      console.error(
        `Failed to post response ${target.responseId} for review ${target.reviewId}:`,
        err
      );

      failed++;
    }
  }

  return { posted, failed, skipped };
}
