import { withRetry } from "../config/retry";

interface LocalResponse {
  text: string;
  model: string;
  tokensUsed: number;
}

export async function callLocal(
  systemPrompt: string,
  userMessage: string
): Promise<LocalResponse> {
  const baseUrl = process.env.LM_STUDIO_URL;
  if (!baseUrl) throw new Error("LM_STUDIO_URL not configured");

  return withRetry(async () => {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        max_tokens: 1024,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LM Studio ${response.status}: ${body}`);
    }

    const data = await response.json();

    return {
      text: data.choices[0]?.message?.content ?? "",
      model: data.model ?? "local",
      tokensUsed:
        (data.usage?.prompt_tokens ?? 0) +
        (data.usage?.completion_tokens ?? 0),
    };
  });
}
