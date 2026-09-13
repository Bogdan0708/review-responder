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
  version?: number;
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
  version?: number;
  approvedText?: string | null;
  publicationToken?: string | null;
  publicationState?: string;
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

function normalized(row: any) {
  return {
    version: 0,
    approvedText: row.approvedAt ? (row.finalText ?? row.draftText) : null,
    publicationToken: null,
    publicationState: row.postedAt
      ? "posted"
      : row.publishClaimedAt
        ? "reconciliation"
        : "idle",
    ...row,
  };
}
function matches(row: any, where: any): boolean {
  const r = normalized(row);
  return Object.entries(where).every(([key, value]) =>
    key === "OR"
      ? (value as any[]).some((w) => matches(r, w))
      : matchesNullFilter(r[key], value),
  );
}
function assign(row: any, data: any) {
  for (const [k, v] of Object.entries(data))
    row[k] =
      v && typeof v === "object" && "increment" in v
        ? (row[k] ?? 0) + (v as any).increment
        : v;
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
          (where.status === undefined || r.status === where.status),
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
                matchesNullFilter(resp.postedAt, w.postedAt)),
          )
          .sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime());
        if (responseFilter.take)
          responses = responses.slice(0, responseFilter.take);
        return { ...r, responses: responses.map((resp) => normalized(resp)) };
      });
    }),

    findUnique: vi.fn(async (args: any) => {
      const row = this.reviews.find((r) => r.id === args.where.id);
      if (!row) return null;
      const responseFilter = args?.include?.responses;
      if (!responseFilter) return normalized(row);
      const w = responseFilter.where ?? {};
      let responses = this.responses
        .filter((resp) => resp.reviewId === row.id)
        .filter(
          (resp) =>
            (w.approvedAt === undefined ||
              matchesNullFilter(resp.approvedAt, w.approvedAt)) &&
            (w.postedAt === undefined ||
              matchesNullFilter(resp.postedAt, w.postedAt)),
        )
        .sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime());
      if (responseFilter.take)
        responses = responses.slice(0, responseFilter.take);
      return { ...row, responses: responses.map((resp) => normalized(resp)) };
    }),

    update: vi.fn(async (args: any) => {
      const row = this.reviews.find((r) => r.id === args.where.id);
      if (!row) throw new Error(`review ${args.where.id} not found`);
      assign(row, args.data);
      return normalized(row);
    }),
  };

  response = {
    findUnique: vi.fn(async (args: any) => {
      const row = this.responses.find((r) => r.id === args.where.id);
      return row ? normalized(row) : null;
    }),

    findFirst: vi.fn(async (args: any) => {
      const w = args?.where ?? {};
      const rows = this.responses
        .filter((r) => matches(r, w))
        .sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime());
      return rows[0] ? normalized(rows[0]) : null;
    }),

    update: vi.fn(async (args: any) => {
      const row = this.responses.find((r) => r.id === args.where.id);
      if (!row) throw new Error(`response ${args.where.id} not found`);
      assign(row, args.data);
      return normalized(row);
    }),

    /** The atomic claim / release both go through updateMany. */
    updateMany: vi.fn(async (args: any) => {
      const w = args?.where ?? {};
      const matched = this.responses.filter((r) => matches(r, w));
      for (const row of matched) assign(row, args.data);
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

  $transaction = vi.fn(async (ops: any) => {
    if (typeof ops !== "function") return Promise.all(ops);
    const backup = structuredClone({
      reviews: this.reviews,
      responses: this.responses,
      auditEntries: this.auditEntries,
    });
    try {
      return await ops(this);
    } catch (error) {
      Object.assign(this, backup);
      throw error;
    }
  });
}

/** Build the object that `@/lib/db`'s `prisma` export is mocked with. */
export function createFakePrisma(): FakePrisma {
  return new FakePrisma();
}
