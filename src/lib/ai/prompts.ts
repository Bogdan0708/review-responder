export interface PromptContext {
  reviewText: string;
  authorName: string | null;
  rating: number;
  sentiment: string;
  topics: string[];
  brandVoice: {
    systemPrompt: string;
    menuHighlights: string[];
  };
}

export function buildSystemPrompt(context: PromptContext): string {
  return `${context.brandVoice.systemPrompt}

Menu highlights: ${context.brandVoice.menuHighlights.join(", ")}`;
}

export function buildUserPrompt(context: PromptContext): string {
  const parts = [
    `Rating: ${context.rating}/5`,
    `Sentiment: ${context.sentiment}`,
  ];

  if (context.authorName) {
    parts.push(`Reviewer: ${context.authorName}`);
  }

  if (context.topics.length > 0) {
    parts.push(`Topics mentioned: ${context.topics.join(", ")}`);
  }

  parts.push(`\nReview:\n${context.reviewText}`);
  parts.push(`\nWrite a response to this review. ${getInstructions(context.sentiment)}`);

  return parts.join("\n");
}

function getInstructions(sentiment: string): string {
  switch (sentiment) {
    case "positive":
      return "Thank the reviewer warmly, reference specific items they mentioned, and invite them back. Keep it 2-3 sentences.";
    case "neutral":
      return "Thank the reviewer, acknowledge their feedback, and mention your commitment to improvement. Keep it 2-4 sentences.";
    case "negative":
      return "Apologize sincerely, acknowledge the specific issue, and offer to resolve it offline. Never be defensive. Keep it 3-5 sentences.";
    default:
      return "Respond appropriately to this review. Keep it 2-4 sentences.";
  }
}
