import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/api-session";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireSession(request);
  if (guard.error) return guard.error;
  const session = guard.session;

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

    if (response.postedAt) {
      return NextResponse.json(
        { error: "Response has already been published and cannot be edited" },
        { status: 409 }
      );
    }

    // Approved text is immutable. Without this, approve -> edit -> cron would
    // publish text that was never approved: the approval names a response id,
    // and the publisher reads that row's text. Rejecting the review clears
    // approvedAt and makes the draft editable again.
    if (response.approvedAt) {
      return NextResponse.json(
        {
          error:
            "Response is approved and cannot be edited; reject the review first to edit the draft",
        },
        { status: 409 }
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
          actor: session.actor,
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
