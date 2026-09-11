import reviews from "../../../../fixtures/reviews.json";
import type { GoogleClient } from "../../reviews/approve";

export type { GoogleClient };

/**
 * In-memory stand-in for the real Google Business Profile client.
 * Used by unit tests and by `npm run demo` so neither needs real
 * Google credentials or network access.
 */
export class FakeGoogle implements GoogleClient {
  published: { id: string; text: string }[] = [];
  private failing = new Set<string>();

  async listReviews() {
    return reviews;
  }

  /** Make the next reply() call for this review id fail once (simulates a Google outage). */
  failNext(id: string): void {
    this.failing.add(id);
  }

  async reply(id: string, text: string): Promise<{ ok: boolean }> {
    if (this.failing.has(id)) {
      this.failing.delete(id);
      return { ok: false };
    }
    this.published.push({ id, text });
    return { ok: true };
  }
}
