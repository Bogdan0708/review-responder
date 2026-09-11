import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { responseId, text } = body as { responseId: string; text: string };

    if (!responseId || !text) {
      return NextResponse.json(
        { error: "responseId and text are required" },
        { status: 400 }
      );
    }

    const response = await prisma.response.findUnique({
      where: { id: responseId },
    });

    if (!response || response.reviewId !== id) {
      return NextResponse.json(
        { error: "Response not found" },
        { status: 404 }
      );
    }

    await prisma.$transaction([
      prisma.response.update({
        where: { id: responseId },
        data: { finalText: text },
      }),
      prisma.auditLog.create({
        data: {
          reviewId: id,
          action: "response_edited",
          actor: "dashboard",
          details: { responseId },
        },
      }),
    ]);

    return NextResponse.json({ message: "Response updated" });
  } catch (err) {
    console.error("Error updating response:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
