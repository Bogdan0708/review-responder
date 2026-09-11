import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

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

    await prisma.$transaction([
      prisma.review.update({
        where: { id },
        data: { status: "rejected" },
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
