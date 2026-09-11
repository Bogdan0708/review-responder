import { Suspense } from "react";
import ReviewList from "@/components/ReviewList";

export default function ReviewsPage() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-zinc-900 dark:text-zinc-50">
        Reviews
      </h1>
      <Suspense
        fallback={
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600 dark:border-zinc-700 dark:border-t-zinc-400" />
          </div>
        }
      >
        <ReviewList />
      </Suspense>
    </div>
  );
}
