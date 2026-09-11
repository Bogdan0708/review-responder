import { prisma } from "../db";
import { generateResponse } from "../ai/generate";
import { notifyWebhook } from "../webhooks/notify";

export interface IngestReviewInput {
  platform: string;
  externalId: string;
  authorName?: string;
  rating: number;
  reviewText: string;
  reviewDate?: string;
}

interface IngestResult {
  reviewId: string;
  status: "created" | "duplicate";
}

export function classifySentiment(
  rating: number
): "positive" | "neutral" | "negative" {
  if (rating >= 4) return "positive";
  if (rating === 3) return "neutral";
  return "negative";
}

const TOPIC_PATTERNS: Record<string, RegExp> = {
  service:
    /\b(service|staff|waiter|waitress|server|rude|friendly|attentive|slow)\b/i,
  "wait time":
    /\b(wait|waiting|slow|quick|fast|long time|minutes|hour)\b/i,
  ambiance:
    /\b(ambiance|atmosphere|decor|music|loud|cozy|clean|dirty)\b/i,
  price:
    /\b(price|expensive|cheap|affordable|value|worth|overpriced)\b/i,
  portion: /\b(portion|size|small|large|big|generous|tiny)\b/i,
};

export function extractTopics(
  text: string,
  menuHighlights: string[] = []
): string[] {
  const topics: string[] = [];

  for (const item of menuHighlights) {
    if (text.toLowerCase().includes(item.toLowerCase())) {
      topics.push(item);
    }
  }

  for (const [topic, pattern] of Object.entries(TOPIC_PATTERNS)) {
    if (pattern.test(text)) {
      topics.push(topic);
    }
  }

  return [...new Set(topics)];
}

const FOOD_SAFETY_KEYWORDS =
  /\b(sick|food poisoning|ill|vomit|diarrhea|allergic|allergy|allergen|contaminated|undercooked|raw|expired|moldy|bug|insect|hair|foreign object)\b/i;

export function containsFoodSafetyKeywords(text: string): boolean {
  return FOOD_SAFETY_KEYWORDS.test(text);
}

export async function ingestReview(
  input: IngestReviewInput
): Promise<IngestResult> {
  const existing = await prisma.review.findUnique({
    where: {
      platform_externalId: {
        platform: input.platform,
        externalId: input.externalId,
      },
    },
  });

  if (existing) {
    return { reviewId: existing.id, status: "duplicate" };
  }

  const brandVoiceSetting = await prisma.setting.findUnique({
    where: { key: "brand_voice" },
  });
  const menuHighlights =
    (brandVoiceSetting?.value as { menuHighlights?: string[] })
      ?.menuHighlights ?? [];

  const sentiment = classifySentiment(input.rating);
  const topics = extractTopics(input.reviewText, menuHighlights);

  const review = await prisma.review.create({
    data: {
      platform: input.platform,
      externalId: input.externalId,
      authorName: input.authorName ?? null,
      rating: input.rating,
      reviewText: input.reviewText,
      reviewDate: input.reviewDate ? new Date(input.reviewDate) : null,
      sentiment,
      topics,
      status: "pending",
    },
  });

  await prisma.auditLog.create({
    data: {
      reviewId: review.id,
      action: "review_ingested",
      details: { platform: input.platform, sentiment, topics },
    },
  });

  // Notify n8n (fire-and-forget)
  notifyWebhook("new_review", {
    reviewId: review.id,
    platform: input.platform,
    rating: input.rating,
    sentiment,
    authorName: input.authorName ?? "Anonymous",
    previewText: input.reviewText.slice(0, 200),
  });

  if (sentiment === "negative") {
    notifyWebhook("negative_review", {
      reviewId: review.id,
      platform: input.platform,
      rating: input.rating,
      authorName: input.authorName ?? "Anonymous",
      reviewText: input.reviewText,
      hasFoodSafetyConcern: containsFoodSafetyKeywords(input.reviewText),
    });
  }

  // Generate draft async — don't block webhook response
  processReviewDraft(review.id).catch((err) =>
    console.error(`Draft generation failed for review ${review.id}:`, err)
  );

  return { reviewId: review.id, status: "created" };
}

async function processReviewDraft(reviewId: string): Promise<void> {
  const review = await prisma.review.findUniqueOrThrow({
    where: { id: reviewId },
  });

  const result = await generateResponse({
    reviewText: review.reviewText,
    authorName: review.authorName,
    rating: review.rating,
    sentiment: review.sentiment,
    topics: review.topics as string[],
  });

  await prisma.response.create({
    data: {
      reviewId: review.id,
      draftText: result.text,
      llmModel: result.model,
      llmTokensUsed: result.tokensUsed,
    },
  });

  // Check auto-approve eligibility
  const autoApproveSetting = await prisma.setting.findUnique({
    where: { key: "auto_approve" },
  });
  const autoApproveEnabled =
    (autoApproveSetting?.value as { enabled?: boolean })?.enabled ?? false;

  const shouldAutoApprove =
    autoApproveEnabled &&
    review.sentiment === "positive" &&
    review.rating >= 4 &&
    !containsFoodSafetyKeywords(review.reviewText);

  const newStatus = shouldAutoApprove ? "approved" : "draft_ready";

  await prisma.review.update({
    where: { id: review.id },
    data: { status: newStatus },
  });

  await prisma.auditLog.create({
    data: {
      reviewId: review.id,
      action: shouldAutoApprove ? "auto_approved" : "draft_generated",
      details: { model: result.model, tokensUsed: result.tokensUsed },
    },
  });
}
