import { withRetry } from "../config/retry";

interface OpenAIResponse {
  text: string;
  model: string;
  tokensUsed: number;
}

export async function callOpenAI(
  systemPrompt: string,
  userMessage: string
): Promise<OpenAIResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  return withRetry(async () => {
    const response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          max_tokens: 1024,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
        }),
        signal: AbortSignal.timeout(30000),
      }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI API ${response.status}: ${body}`);
    }

    const data = await response.json();

    return {
      text: data.choices[0]?.message?.content ?? "",
      model: data.model,
      tokensUsed:
        (data.usage?.prompt_tokens ?? 0) +
        (data.usage?.completion_tokens ?? 0),
    };
  });
}
