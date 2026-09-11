import { vi } from "vitest";

/**
 * A very small stand-in for the generated Prisma client, covering exactly the
 * queries `src/lib/reviews/prisma-store.ts` and
 * `src/lib/google/respond.ts` issue. It exists so tests can drive the REAL
 * worker and the REAL Prisma adapter (selection logic, atomic claim,
 * transactions) without a database.
 */

export interface FakeReviewRow {
  id: string;
  platform: string;
  status: string;
  externalId: string;
  authorName: string | null;
}

export interface FakeResponseRow {
  id: string;
  reviewId: string;
  draftText: string;
  finalText: string | null;
  generatedAt: Date;
  approvedAt: Date | null;
  postedAt: Date | null;
  publishClaimedAt: Date | null;
}

export interface FakeAuditRow {
  reviewId: string | null;
  action: string;
  actor: string;
  details?: unknown;
}

function matchesNullFilter(value: unknown, filter: unknown): boolean {
  if (filter === null) return value === null;
  if (filter && typeof filter === "object") {
    if ("not" in (filter as object)) {
      const not = (filter as { not: unknown }).not;
      if (not === null) return value !== null;
      return value !== not;
    }
    if ("lt" in (filter as object)) {
      const lt = (filter as { lt: Date }).lt;
      if (!(value instanceof Date)) return false;
      return value.getTime() < lt.getTime();
    }
  }
  return value === filter;
}

export class FakePrisma {
  reviews: FakeReviewRow[] = [];
  responses: FakeResponseRow[] = [];
  auditEntries: FakeAuditRow[] = [];

  review = {
    findMany: vi.fn(async (args: any) => {
      const where = args?.where ?? {};
      const rows = this.reviews.filter(
        (r) =>
          (where.platform === undefined || r.platform === where.platform) &&
          (where.status === undefined || r.status === where.status)
      );
      const responseFilter = args?.include?.responses;
      return rows.map((r) => {
        if (!responseFilter) return { ...r };
        const w = responseFilter.where ?? {};
        let responses = this.responses
          .filter((resp) => resp.reviewId === r.id)
          .filter(
            (resp) =>
              (w.approvedAt === undefined ||
                matchesNullFilter(resp.approvedAt, w.approvedAt)) &&
              (w.postedAt === undefined ||
                matchesNullFilter(resp.postedAt, w.postedAt))
          )
          .sort(
            (a, b) =>
              b.generatedAt.getTime() - a.generatedAt.getTime()
          );
        if (responseFilter.take) responses = responses.slice(0, responseFilter.take);
        return { ...r, responses: responses.map((resp) => ({ ...resp })) };
      });
    }),

    findUnique: vi.fn(async (args: any) => {
      const row = this.reviews.find((r) => r.id === args.where.id);
      if (!row) return null;
      const responseFilter = args?.include?.responses;
      if (!responseFilter) return { ...row };
      const w = responseFilter.where ?? {};
      let responses = this.responses
        .filter((resp) => resp.reviewId === row.id)
        .filter(
          (resp) =>
            (w.approvedAt === undefined ||
              matchesNullFilter(resp.approvedAt, w.approvedAt)) &&
            (w.postedAt === undefined ||
              matchesNullFilter(resp.postedAt, w.postedAt))
        )
        .sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime());
      if (responseFilter.take) responses = responses.slice(0, responseFilter.take);
      return { ...row, responses: responses.map((resp) => ({ ...resp })) };
    }),

    update: vi.fn(async (args: any) => {
      const row = this.reviews.find((r) => r.id === args.where.id);
      if (!row) throw new Error(`review ${args.where.id} not found`);
      Object.assign(row, args.data);
      return { ...row };
    }),
  };

  response = {
    findUnique: vi.fn(async (args: any) => {
      const row = this.responses.find((r) => r.id === args.where.id);
      return row ? { ...row } : null;
    }),

    findFirst: vi.fn(async (args: any) => {
      const w = args?.where ?? {};
      const rows = this.responses
        .filter(
          (r) =>
            (w.id === undefined || r.id === w.id) &&
            (w.reviewId === undefined || r.reviewId === w.reviewId)
        )
        .sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime());
      return rows[0] ? { ...rows[0] } : null;
    }),

    update: vi.fn(async (args: any) => {
      const row = this.responses.find((r) => r.id === args.where.id);
      if (!row) throw new Error(`response ${args.where.id} not found`);
      Object.assign(row, args.data);
      return { ...row };
    }),

    /** The atomic claim / release both go through updateMany. */
    updateMany: vi.fn(async (args: any) => {
      const w = args?.where ?? {};
      const matched = this.responses.filter(
        (r) =>
          (w.id === undefined || r.id === w.id) &&
          (w.reviewId === undefined || r.reviewId === w.reviewId) &&
          (w.approvedAt === undefined || matchesNullFilter(r.approvedAt, w.approvedAt)) &&
          (w.postedAt === undefined || matchesNullFilter(r.postedAt, w.postedAt)) &&
          (w.publishClaimedAt === undefined ||
            matchesNullFilter(r.publishClaimedAt, w.publishClaimedAt)) &&
          (w.reviewId === undefined || r.reviewId === w.reviewId)
      );
      for (const row of matched) Object.assign(row, args.data);
      return { count: matched.length };
    }),
  };

  auditLog = {
    create: vi.fn(async (args: any) => {
      this.auditEntries.push(args.data);
      return { ...args.data };
    }),

    deleteMany: vi.fn(async () => ({ count: 0 })),
  };

  $transaction = vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops));
}

/** Build the object that `@/lib/db`'s `prisma` export is mocked with. */
export function createFakePrisma(): FakePrisma {
  return new FakePrisma();
}
