import { notifyWebhook } from "../webhooks/notify";

export const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
  alertAfterFailures: 2,
};

export type RetryConfig = typeof RETRY_CONFIG;

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = RETRY_CONFIG
): Promise<T> {
  let lastError: Error;
  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      if (attempt >= config.alertAfterFailures - 1) {
        await notifyWebhook("api_failure", {
          attempt: attempt + 1,
          error: lastError.message,
        }).catch(() => {}); // Don't fail retry on notification failure
      }
      if (attempt < config.maxRetries - 1) {
        await new Promise((r) =>
          setTimeout(
            r,
            config.initialDelayMs *
              Math.pow(config.backoffMultiplier, attempt)
          )
        );
      }
    }
  }
  throw lastError!;
}
