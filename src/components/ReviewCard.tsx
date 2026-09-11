import Link from "next/link";

interface ReviewCardProps {
  id: string;
  platform: string;
  authorName: string | null;
  rating: number;
  reviewText: string;
  sentiment: string;
  status: string;
  ingestedAt: string;
  hasResponse: boolean;
}

const sentimentStyles: Record<string, string> = {
  positive:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  neutral:
    "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  negative: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
};

const statusStyles: Record<string, string> = {
  pending: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  draft_ready:
    "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
  approved:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  rejected: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
  posted:
    "bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-400",
};

const statusLabels: Record<string, string> = {
  pending: "Pending",
  draft_ready: "Draft Ready",
  approved: "Approved",
  rejected: "Rejected",
  posted: "Posted",
};

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex gap-0.5" title={`${rating}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={i <= rating ? "text-amber-400" : "text-zinc-300 dark:text-zinc-600"}
        >
          &#9733;
        </span>
      ))}
    </span>
  );
}

export default function ReviewCard({
  id,
  platform,
  authorName,
  rating,
  reviewText,
  sentiment,
  status,
  ingestedAt,
  hasResponse,
}: ReviewCardProps) {
  const date = new Date(ingestedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <Link
      href={`/reviews/${id}`}
      className="block rounded-lg border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {authorName ?? "Anonymous"}
            </span>
            <Stars rating={rating} />
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              {platform}
            </span>
          </div>
          <p className="mt-1.5 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">
            {reviewText}
          </p>
        </div>
        <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusStyles[status] ?? statusStyles.pending}`}
          >
            {statusLabels[status] ?? status}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${sentimentStyles[sentiment] ?? sentimentStyles.neutral}`}
          >
            {sentiment}
          </span>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-500">
        <span>{date}</span>
        {hasResponse && <span>Draft available</span>}
      </div>
    </Link>
  );
}
