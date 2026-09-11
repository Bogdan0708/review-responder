import Link from "next/link";
import { prisma } from "@/lib/db";
import StatsCard from "@/components/StatsCard";

// Force dynamic rendering - DB not available at build time
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [totalReviews, pendingReviews, approvedToday, avgRating] =
    await Promise.all([
      prisma.review.count(),
      prisma.review.count({
        where: { status: { in: ["pending", "draft_ready"] } },
      }),
      prisma.auditLog.count({
        where: {
          action: { in: ["response_approved", "auto_approved"] },
          createdAt: { gte: today },
        },
      }),
      prisma.review.aggregate({ _avg: { rating: true } }),
    ]);

  const recentReviews = await prisma.review.findMany({
    orderBy: { ingestedAt: "desc" },
    take: 5,
    include: { responses: { orderBy: { generatedAt: "desc" }, take: 1 } },
  });

  const rating = avgRating._avg.rating
    ? Number(avgRating._avg.rating.toFixed(1))
    : 0;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-zinc-900 dark:text-zinc-50">
        Dashboard
      </h1>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Total Reviews"
          value={totalReviews}
          color="blue"
        />
        <StatsCard
          title="Needs Action"
          value={pendingReviews}
          subtitle={pendingReviews > 0 ? "Reviews awaiting response" : "All caught up"}
          color="amber"
        />
        <StatsCard
          title="Approved Today"
          value={approvedToday}
          color="green"
        />
        <StatsCard
          title="Avg Rating"
          value={rating > 0 ? `${rating} / 5` : "N/A"}
          color="default"
        />
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Recent Reviews
          </h2>
          <Link
            href="/reviews"
            className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            View all
          </Link>
        </div>

        {recentReviews.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 py-12 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            No reviews yet. Reviews will appear here once ingested via webhook.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {recentReviews.map((review) => (
              <Link
                key={review.id}
                href={`/reviews/${review.id}`}
                className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-3 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {review.authorName ?? "Anonymous"}
                    </span>
                    <span className="flex gap-0.5 text-sm">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <span
                          key={i}
                          className={
                            i <= review.rating
                              ? "text-amber-400"
                              : "text-zinc-300 dark:text-zinc-600"
                          }
                        >
                          &#9733;
                        </span>
                      ))}
                    </span>
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      {review.platform}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm text-zinc-500 dark:text-zinc-400">
                    {review.reviewText}
                  </p>
                </div>
                <span
                  className={`ml-3 flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                    review.status === "approved"
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                      : review.status === "draft_ready"
                        ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400"
                        : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                  }`}
                >
                  {review.status === "draft_ready" ? "Draft Ready" : review.status}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
