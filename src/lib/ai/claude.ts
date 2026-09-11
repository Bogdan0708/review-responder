import { withRetry } from "../config/retry";

interface ClaudeResponse {
  text: string;
  model: string;
  tokensUsed: number;
}

export async function callClaude(
  systemPrompt: string,
  userMessage: string
): Promise<ClaudeResponse> {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error("CLAUDE_API_KEY not configured");

  return withRetry(async () => {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Claude API ${response.status}: ${body}`);
    }

    const data = await response.json();
    const textBlock = data.content.find(
      (b: { type: string }) => b.type === "text"
    );

    return {
      text: textBlock?.text ?? "",
      model: data.model,
      tokensUsed:
        (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
    };
  });
}
