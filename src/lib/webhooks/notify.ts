type WebhookEvent =
  | "new_review"
  | "negative_review"
  | "response_posted"
  | "api_failure";

export async function notifyWebhook(
  event: WebhookEvent,
  payload: Record<string, unknown>
): Promise<void> {
  const baseUrl = process.env.N8N_WEBHOOK_BASE;
  if (!baseUrl) return;

  const url = `${baseUrl}/${event}`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        timestamp: new Date().toISOString(),
        ...payload,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.error(`Webhook ${event} failed: ${response.status}`);
    }
  } catch (err) {
    console.error(`Webhook ${event} error:`, err);
  }
}
