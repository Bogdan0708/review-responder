import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-session";
import { editDraft } from "@/lib/reviews/transitions";
import { TransitionConflict } from "@/lib/reviews/approve";
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireSession(request);
  if (guard.error) return guard.error;
  try {
    const { id } = await params;
    const body = await request.json();
    const { responseId, text, version } = body;
    if (
      typeof responseId !== "string" ||
      typeof text !== "string" ||
      !text.trim() ||
      !Number.isInteger(version) ||
      version < 0
    )
      return NextResponse.json(
        {
          error:
            "responseId, text and nonnegative integer version are required",
        },
        { status: 400 },
      );
    await editDraft(id, responseId, text, version, guard.session.actor);
    return NextResponse.json({ message: "Response updated" });
  } catch (error) {
    if (error instanceof TransitionConflict)
      return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof SyntaxError)
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    console.error("Error updating response:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
