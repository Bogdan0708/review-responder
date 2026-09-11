import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { approveAndPublish } from "@/lib/reviews/approve";
import { createPrismaReviewStore } from "@/lib/reviews/prisma-store";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    // Publishing to Google is deferred to the background job
    // (postPendingGoogleResponses); this only records the approval.
    // TODO(auth): derive role from session
    await approveAndPublish({
      reviewId: id,
      text: latestResponse.finalText ?? latestResponse.draftText,
      actor: "dashboard",
      role: "owner",
      store: createPrismaReviewStore(),
    });

    return NextResponse.json({ message: "Response approved" });
  } catch (err) {
    console.error("Error approving response:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
