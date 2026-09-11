"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ReviewCard from "./ReviewCard";

interface ReviewWithResponse {
  id: string;
  platform: string;
  authorName: string | null;
  rating: number;
  reviewText: string;
  sentiment: string;
  status: string;
  ingestedAt: string;
  responses: { id: string }[];
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "pending", label: "Pending" },
  { value: "draft_ready", label: "Draft Ready" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "posted", label: "Posted" },
];

const PLATFORM_OPTIONS = [
  { value: "all", label: "All Platforms" },
  { value: "google", label: "Google" },
  { value: "tripadvisor", label: "TripAdvisor" },
  { value: "manual", label: "Manual" },
];

const SENTIMENT_OPTIONS = [
  { value: "all", label: "All Sentiments" },
  { value: "positive", label: "Positive" },
  { value: "neutral", label: "Neutral" },
  { value: "negative", label: "Negative" },
];

export default function ReviewList() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [reviews, setReviews] = useState<ReviewWithResponse[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);

  const status = searchParams.get("status") ?? "all";
  const platform = searchParams.get("platform") ?? "all";
  const sentiment = searchParams.get("sentiment") ?? "all";
  const page = parseInt(searchParams.get("page") ?? "1");

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status !== "all") params.set("status", status);
      if (platform !== "all") params.set("platform", platform);
      if (sentiment !== "all") params.set("sentiment", sentiment);
      params.set("page", String(page));

      const res = await fetch(`/api/reviews?${params}`);
      const data = await res.json();
      setReviews(data.reviews);
      setPagination(data.pagination);
    } catch (err) {
      console.error("Failed to fetch reviews:", err);
    } finally {
      setLoading(false);
    }
  }, [status, platform, sentiment, page]);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    params.delete("page");
    router.push(`/reviews?${params.toString()}`);
  }

  function goToPage(p: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(p));
    router.push(`/reviews?${params.toString()}`);
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-3">
        {[
          { key: "status", options: STATUS_OPTIONS, current: status },
          { key: "platform", options: PLATFORM_OPTIONS, current: platform },
          { key: "sentiment", options: SENTIMENT_OPTIONS, current: sentiment },
        ].map((filter) => (
          <select
            key={filter.key}
            value={filter.current}
            onChange={(e) => updateFilter(filter.key, e.target.value)}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
          >
            {filter.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ))}
        <span className="flex items-center text-sm text-zinc-500 dark:text-zinc-400">
          {pagination.total} review{pagination.total !== 1 ? "s" : ""}
        </span>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600 dark:border-zinc-700 dark:border-t-zinc-400" />
        </div>
      ) : reviews.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 py-12 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No reviews found
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {reviews.map((review) => (
            <ReviewCard
              key={review.id}
              id={review.id}
              platform={review.platform}
              authorName={review.authorName}
              rating={review.rating}
              reviewText={review.reviewText}
              sentiment={review.sentiment}
              status={review.status}
              ingestedAt={review.ingestedAt}
              hasResponse={review.responses.length > 0}
            />
          ))}
        </div>
      )}

      {pagination.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => goToPage(page - 1)}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Previous
          </button>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            Page {page} of {pagination.totalPages}
          </span>
          <button
            disabled={page >= pagination.totalPages}
            onClick={() => goToPage(page + 1)}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
