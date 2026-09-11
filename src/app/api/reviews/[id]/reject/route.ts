import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/api-session";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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

    await prisma.$transaction([
      prisma.review.update({
        where: { id },
        data: { status: "rejected" },
      }),
      // Clearing the approval is what makes the draft editable again, and
      // stops the background publisher from picking the response up.
      prisma.response.updateMany({
        where: { reviewId: id, postedAt: null },
        data: { approvedAt: null, publishClaimedAt: null },
      }),
      prisma.auditLog.create({
        data: {
          reviewId: id,
          action: "response_rejected",
          actor: session.actor,
        },
      }),
    ]);

    return NextResponse.json({ message: "Review rejected" });
  } catch (err) {
    console.error("Error rejecting review:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
