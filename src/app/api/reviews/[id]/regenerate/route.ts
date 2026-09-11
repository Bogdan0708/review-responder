import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { generateResponse } from "@/lib/ai/generate";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Verified here as well as in the middleware (defence in depth); the actor
  // is derived from the session, not hard-coded.
  const session = await readSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

    const response = await prisma.response.create({
      data: {
        reviewId: id,
        draftText: result.text,
        llmModel: result.model,
        llmTokensUsed: result.tokensUsed,
      },
    });

    await prisma.$transaction([
      prisma.review.update({
        where: { id },
        data: { status: "draft_ready" },
      }),
      prisma.auditLog.create({
        data: {
          reviewId: id,
          action: "draft_regenerated",
          actor: session.actor,
          details: { responseId: response.id, model: result.model },
        },
      }),
    ]);

    return NextResponse.json({ message: "Draft regenerated", response });
  } catch (err) {
    console.error("Error regenerating response:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
