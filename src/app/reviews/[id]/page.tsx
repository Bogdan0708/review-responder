import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import ResponseEditor from "@/components/ResponseEditor";

interface PageProps {
  params: Promise<{ id: string }>;
}

const sentimentStyles: Record<string, string> = {
  positive:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  neutral: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  negative: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
};

export default async function ReviewDetailPage({ params }: PageProps) {
  const { id } = await params;

  const review = await prisma.review.findUnique({
    where: { id },
    include: {
      responses: { orderBy: { generatedAt: "desc" } },
      auditLogs: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!review) notFound();

  const latestResponse = review.responses[0] ?? null;

  const serializedResponse = latestResponse
    ? {
        id: latestResponse.id,
        draftText: latestResponse.draftText,
        finalText: latestResponse.finalText,
        generatedAt: latestResponse.generatedAt.toISOString(),
        llmModel: latestResponse.llmModel,
        llmTokensUsed: latestResponse.llmTokensUsed,
      }
    : null;

  return (
    <div>
      <Link
        href="/reviews"
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 19l-7-7 7-7"
          />
        </svg>
        Back to Reviews
      </Link>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Review Info */}
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                {review.authorName ?? "Anonymous"}
              </h1>
              <span className="flex gap-0.5 text-lg">
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
              <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {review.platform}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${sentimentStyles[review.sentiment] ?? ""}`}
              >
                {review.sentiment}
              </span>
            </div>

            <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
              {review.reviewText}
            </p>

            <div className="mt-4 flex flex-wrap gap-4 text-xs text-zinc-500 dark:text-zinc-400">
              {review.reviewDate && (
                <span>
                  Review date:{" "}
                  {new Date(review.reviewDate).toLocaleDateString()}
                </span>
              )}
              <span>
                Ingested:{" "}
                {new Date(review.ingestedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
              {(review.topics as string[]).length > 0 && (
                <span>
                  Topics: {(review.topics as string[]).join(", ")}
                </span>
              )}
            </div>
          </div>

          {/* Response Editor */}
          <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <ResponseEditor
              reviewId={review.id}
              response={serializedResponse}
              reviewStatus={review.status}
            />
          </div>
        </div>

        {/* Sidebar - Audit Log */}
        <div>
          <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <h3 className="mb-3 text-sm font-medium text-zinc-900 dark:text-zinc-100">
              Activity
            </h3>
            {review.auditLogs.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                No activity yet.
              </p>
            ) : (
              <div className="space-y-3">
                {review.auditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="border-l-2 border-zinc-200 pl-3 dark:border-zinc-700"
                  >
                    <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      {log.action.replace(/_/g, " ")}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {log.actor} &middot;{" "}
                      {new Date(log.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* All Response Versions */}
          {review.responses.length > 1 && (
            <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <h3 className="mb-3 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Previous Drafts ({review.responses.length - 1})
              </h3>
              <div className="space-y-3">
                {review.responses.slice(1).map((resp) => (
                  <div
                    key={resp.id}
                    className="rounded border border-zinc-100 p-3 dark:border-zinc-800"
                  >
                    <p className="line-clamp-3 text-xs text-zinc-600 dark:text-zinc-400">
                      {resp.draftText}
                    </p>
                    <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                      {resp.llmModel} &middot;{" "}
                      {new Date(resp.generatedAt).toLocaleDateString()}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
