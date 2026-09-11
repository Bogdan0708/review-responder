import { NextRequest, NextResponse } from "next/server";
import { ingestReview, type IngestReviewInput } from "@/lib/reviews/ingest";

function validatePayload(body: unknown): body is IngestReviewInput {
  if (!body || typeof body !== "object") return false;
  const obj = body as Record<string, unknown>;

  if (typeof obj.platform !== "string" || !obj.platform) return false;
  if (typeof obj.externalId !== "string" || !obj.externalId) return false;
  if (
    typeof obj.rating !== "number" ||
    !Number.isInteger(obj.rating) ||
    obj.rating < 1 ||
    obj.rating > 5
  )
    return false;
  if (typeof obj.reviewText !== "string" || !obj.reviewText) return false;

  if (obj.authorName !== undefined && typeof obj.authorName !== "string")
    return false;
  if (obj.reviewDate !== undefined && typeof obj.reviewDate !== "string")
    return false;

  return true;
}

export async function POST(request: NextRequest) {
  // The middleware exempts /api/webhooks (the callers are machines, not
  // browsers), so this shared secret is the only thing guarding ingestion.
  // An unset WEBHOOK_SECRET fails closed.
  const webhookSecret = process.env.WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json(
      { error: "WEBHOOK_SECRET is not configured" },
      { status: 503 }
    );
  }
  if (request.headers.get("x-webhook-secret") !== webhookSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    if (!validatePayload(body)) {
      return NextResponse.json(
        {
          error: "Invalid payload",
          required: {
            platform: "string (google | tripadvisor | manual)",
            externalId: "string",
            rating: "integer (1-5)",
            reviewText: "string",
          },
          optional: {
            authorName: "string",
            reviewDate: "string (ISO 8601)",
          },
        },
        { status: 400 }
      );
    }

    const result = await ingestReview(body);

    if (result.status === "duplicate") {
      return NextResponse.json(
        { message: "Review already exists", reviewId: result.reviewId },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { message: "Review ingested", reviewId: result.reviewId },
      { status: 201 }
    );
  } catch (err) {
    console.error("Webhook ingestion error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
