import { prisma } from "../db";
import { callClaude } from "./claude";
import { callOpenAI } from "./openai";
import { callLocal } from "./local";
import { buildSystemPrompt, buildUserPrompt } from "./prompts";

interface GenerateResult {
  text: string;
  model: string;
  tokensUsed: number;
}

interface ReviewInput {
  reviewText: string;
  authorName: string | null;
  rating: number;
  sentiment: string;
  topics: string[];
}

type LLMProvider = (system: string, user: string) => Promise<GenerateResult>;

const PROVIDER_MAP: Record<string, LLMProvider> = {
  claude: callClaude,
  openai: callOpenAI,
  "lm-studio": callLocal,
};

export async function generateResponse(
  review: ReviewInput
): Promise<GenerateResult> {
  const brandVoiceSetting = await prisma.setting.findUnique({
    where: { key: "brand_voice" },
  });

  const brandVoice = (brandVoiceSetting?.value as {
    systemPrompt: string;
    menuHighlights: string[];
  }) ?? {
    systemPrompt:
      "Respond to this restaurant review in a warm, friendly tone.",
    menuHighlights: [],
  };

  const context = {
    reviewText: review.reviewText,
    authorName: review.authorName,
    rating: review.rating,
    sentiment: review.sentiment,
    topics: review.topics,
    brandVoice,
  };

  const systemPrompt = buildSystemPrompt(context);
  const userMessage = buildUserPrompt(context);

  const providerSetting = await prisma.setting.findUnique({
    where: { key: "llm_provider" },
  });

  const providers = (providerSetting?.value as {
    primary: string;
    fallback: string;
    local: string;
  }) ?? { primary: "claude", fallback: "openai", local: "lm-studio" };

  const chain: { name: string; fn: LLMProvider }[] = [
    providers.primary,
    providers.fallback,
    providers.local,
  ]
    .filter((name) => PROVIDER_MAP[name])
    .map((name) => ({ name, fn: PROVIDER_MAP[name] }));

  let lastError: Error | null = null;

  for (const provider of chain) {
    try {
      console.log(`Trying LLM provider: ${provider.name}`);
      return await provider.fn(systemPrompt, userMessage);
    } catch (err) {
      lastError = err as Error;
      console.error(`Provider ${provider.name} failed:`, lastError.message);
    }
  }

  throw new Error(
    `All LLM providers failed. Last error: ${lastError?.message}`
  );
}
