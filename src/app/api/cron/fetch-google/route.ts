import { NextRequest, NextResponse } from "next/server";
import { fetchGoogleReviews } from "@/lib/google/reviews";
import { postPendingGoogleResponses } from "@/lib/google/respond";

export async function POST(request: NextRequest) {
  // The middleware exempts /api/cron, so this shared secret is the only thing
  // guarding the endpoint: an unset CRON_SECRET must fail closed, not open.
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 503 }
    );
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Step 1: Fetch new reviews from Google
    const fetchResult = await fetchGoogleReviews();

    // Step 2: Post approved responses back to Google
    const postResult = await postPendingGoogleResponses();

    return NextResponse.json({
      success: true,
      reviews: fetchResult,
      responses: postResult,
    });
  } catch (err) {
    console.error("Google cron job failed:", err);
    return NextResponse.json(
      {
        error: "Cron job failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
