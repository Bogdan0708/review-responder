import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
          actor: "dashboard",
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
