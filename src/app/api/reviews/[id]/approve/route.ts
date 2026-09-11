import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

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

    await prisma.$transaction([
      prisma.response.update({
        where: { id: latestResponse.id },
        data: {
          approvedAt: new Date(),
          finalText: latestResponse.finalText ?? latestResponse.draftText,
        },
      }),
      prisma.review.update({
        where: { id },
        data: { status: "approved" },
      }),
      prisma.auditLog.create({
        data: {
          reviewId: id,
          action: "response_approved",
          actor: "dashboard",
          details: { responseId: latestResponse.id },
        },
      }),
    ]);

    return NextResponse.json({ message: "Response approved" });
  } catch (err) {
    console.error("Error approving response:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
