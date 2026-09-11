import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Prisma singleton so generateResponse never touches a real database.
vi.mock("@/lib/db", () => ({
  prisma: {
    setting: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

// Mock the three provider adapters individually so we control success/failure per test.
vi.mock("@/lib/ai/claude", () => ({ callClaude: vi.fn() }));
vi.mock("@/lib/ai/openai", () => ({ callOpenAI: vi.fn() }));
vi.mock("@/lib/ai/local", () => ({ callLocal: vi.fn() }));

import { generateResponse } from "@/lib/ai/generate";
import { callClaude } from "@/lib/ai/claude";
import { callOpenAI } from "@/lib/ai/openai";
import { callLocal } from "@/lib/ai/local";
import reviews from "../fixtures/reviews.json";

const review = {
  reviewText: reviews[0].reviewText,
  authorName: reviews[0].authorName,
  rating: reviews[0].rating,
  sentiment: reviews[0].sentiment,
  topics: reviews[0].topics,
};

describe("generateResponse provider fallback", () => {
  beforeEach(() => {
    vi.mocked(callClaude).mockReset();
    vi.mocked(callOpenAI).mockReset();
    vi.mocked(callLocal).mockReset();
  });

  it("falls back to the next provider when the first throws", async () => {
    vi.mocked(callClaude).mockRejectedValue(new Error("429"));
    vi.mocked(callOpenAI).mockResolvedValue({
      text: "Thank you for visiting The Example Bistro!",
      model: "gpt-4o-mini",
      tokensUsed: 42,
    });

    const out = await generateResponse(review);

    expect(out.text).toMatch(/Thank you/);
    expect(callClaude).toHaveBeenCalledTimes(1);
    expect(callOpenAI).toHaveBeenCalledTimes(1);
    expect(callLocal).not.toHaveBeenCalled();
  });

  it("falls through claude and openai to the local provider", async () => {
    vi.mocked(callClaude).mockRejectedValue(new Error("claude down"));
    vi.mocked(callOpenAI).mockRejectedValue(new Error("openai down"));
    vi.mocked(callLocal).mockResolvedValue({
      text: "Thanks so much for the kind words!",
      model: "local-model",
      tokensUsed: 10,
    });

    const out = await generateResponse(review);

    expect(out.text).toMatch(/Thanks/);
    expect(callClaude).toHaveBeenCalledTimes(1);
    expect(callOpenAI).toHaveBeenCalledTimes(1);
    expect(callLocal).toHaveBeenCalledTimes(1);
  });

  it("rejects when every provider throws", async () => {
    vi.mocked(callClaude).mockRejectedValue(new Error("claude down"));
    vi.mocked(callOpenAI).mockRejectedValue(new Error("openai down"));
    vi.mocked(callLocal).mockRejectedValue(new Error("local down"));

    await expect(generateResponse(review)).rejects.toThrow(/All LLM providers failed/);
  });
});
