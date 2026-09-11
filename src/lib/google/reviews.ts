import { getAccessToken, clearTokenCache } from "./auth";
import { withRetry } from "../config/retry";
import { ingestReview, type IngestReviewInput } from "../reviews/ingest";

const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";

interface GoogleReview {
  reviewId: string;
  reviewer: {
    displayName?: string;
    profilePhotoUrl?: string;
  };
  starRating: "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE";
  comment?: string;
  createTime: string;
  updateTime: string;
  reviewReply?: {
    comment: string;
    updateTime: string;
  };
}

interface ListReviewsResponse {
  reviews?: GoogleReview[];
  averageRating?: number;
  totalReviewCount?: number;
  nextPageToken?: string;
}

const STAR_RATING_MAP: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

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

async function fetchWithAuth(url: string, init?: RequestInit): Promise<Response> {
  const token = await getAccessToken();
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  // If token expired mid-request, clear cache and let retry handle it
  if (response.status === 401) {
    clearTokenCache();
    throw new Error("Google API returned 401 — token may be expired");
  }

  return response;
}

export async function fetchGoogleReviews(): Promise<{
  ingested: number;
  duplicates: number;
  errors: number;
}> {
  const locationName = getGoogleLocationName();
  let ingested = 0;
  let duplicates = 0;
  let errors = 0;
  let pageToken: string | undefined;

  do {
    const url = new URL(`${GBP_API_BASE}/${locationName}/reviews`);
    url.searchParams.set("pageSize", "50");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const response = await withRetry(() => fetchWithAuth(url.toString()));

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Google Reviews API error (${response.status}): ${body}`
      );
    }

    const data: ListReviewsResponse = await response.json();

    if (data.reviews) {
      for (const review of data.reviews) {
        try {
          const result = await ingestGoogleReview(review);
          if (result === "created") ingested++;
          else duplicates++;
        } catch (err) {
          console.error(
            `Failed to ingest Google review ${review.reviewId}:`,
            err
          );
          errors++;
        }
      }
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return { ingested, duplicates, errors };
}

async function ingestGoogleReview(
  review: GoogleReview
): Promise<"created" | "duplicate"> {
  const input: IngestReviewInput = {
    platform: "google",
    externalId: review.reviewId,
    authorName: review.reviewer.displayName,
    rating: STAR_RATING_MAP[review.starRating] ?? 3,
    reviewText: review.comment ?? "",
    reviewDate: review.createTime,
  };

  const result = await ingestReview(input);
  return result.status;
}
