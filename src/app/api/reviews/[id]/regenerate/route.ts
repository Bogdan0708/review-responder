import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/api-session";
import { saveRegeneratedDraft } from "@/lib/reviews/transitions";
import { TransitionConflict } from "@/lib/reviews/approve";
import { generateResponse } from "@/lib/ai/generate";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Verified here as well as in the middleware (defence in depth); the actor
  // is derived from the session, not hard-coded.
  const guard = await requireSession(request);
  if (guard.error) return guard.error;
  const session = guard.session;

  try {
    const { id } = await params;
    const review = await prisma.review.findUnique({ where: { id } });

    if (!review) {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }

    const result = await generateResponse({
      reviewText: review.reviewText,
      authorName: review.authorName,
      rating: review.rating,
      sentiment: review.sentiment,
      topics: review.topics as string[],
    });

    const response = await saveRegeneratedDraft(
      id,
      review.version,
      result,
      session.actor,
    );

    return NextResponse.json({ message: "Draft regenerated", response });
  } catch (err) {
    if (err instanceof TransitionConflict)
      return NextResponse.json({ error: err.message }, { status: 409 });
    console.error("Error regenerating response:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
