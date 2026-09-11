import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { approveResponse, publishApproved } from "@/lib/reviews/approve";
import { createPrismaReviewStore } from "@/lib/reviews/prisma-store";
import { createGoogleReplyClient } from "@/lib/google/respond";

/**
 * Approve the latest draft for a review, and optionally publish it right away
 * (`?publish=1`); otherwise publication is left to the background job.
 *
 * The session is verified here as well as in the middleware (defence in
 * depth), and the actor/role come from that verified session — never from the
 * request body and never hard-coded.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await readSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const review = await prisma.review.findUnique({
      where: { id },
      include: { responses: { orderBy: { generatedAt: "desc" }, take: 1 } },
    });

    if (!review) {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }

    const latestResponse = review.responses[0];
    if (!latestResponse) {
      return NextResponse.json(
        { error: "No response to approve" },
        { status: 400 }
      );
    }

    const store = createPrismaReviewStore();

    // Approval is bound to this exact response id and the text stored on it.
    const approved = await approveResponse({
      reviewId: id,
      responseId: latestResponse.id,
      text: latestResponse.finalText ?? latestResponse.draftText,
      actor: session.actor,
      role: session.role,
      store,
    });

    const publishNow =
      new URL(request.url).searchParams.get("publish") === "1";

    if (!publishNow) {
      return NextResponse.json({
        message: "Response approved",
        responseId: approved.responseId,
        posted: false,
      });
    }

    // Publishes the stored approved text of that same response id.
    const result = await publishApproved({
      reviewId: id,
      responseId: approved.responseId,
      store,
      google: createGoogleReplyClient(review.externalId),
      actor: session.actor,
    });

    return NextResponse.json({
      message: result.posted
        ? "Response approved and published"
        : "Response approved; publication is already claimed by another worker",
      responseId: approved.responseId,
      posted: result.posted,
    });
  } catch (err) {
    console.error("Error approving response:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
