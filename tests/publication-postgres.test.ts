import { execFile } from "node:child_process";
import { promisify } from "node:util";
/** Real PostgreSQL tests. Opt in only with a disposable localhost test database.
 * This suite creates and drops its own schema, never an existing app schema. */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { NextRequest } from "next/server";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { createSessionToken, COOKIE_NAME } from "../src/lib/session";
import { approveResponse, publishApproved } from "../src/lib/reviews/approve";
const testUrl = process.env.RR_TEST_DATABASE_URL;
const schema = `rr_integrity_${process.pid}`;
let db: PrismaClient;
let admin: PrismaClient;
let store: ReturnType<
  typeof import("../src/lib/reviews/prisma-store").createPrismaReviewStore
>;
let transitions: typeof import("../src/lib/reviews/transitions");
let cookie: string;
let reviewId: string;
let responseId: string;
function request(action: string, body: unknown = {}, method = "POST") {
  return new NextRequest(`http://localhost/api/reviews/${reviewId}/${action}`, {
    method,
    headers: {
      cookie: `${COOKIE_NAME}=${cookie}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
function params() {
  return { params: Promise.resolve({ id: reviewId }) };
}
const owner = { actor: "owner", role: "owner" };
const approval = () =>
  approveResponse({
    reviewId,
    responseId,
    text: "original",
    version: 0,
    store,
    ...owner,
  });
async function seed() {
  const review = await db.review.create({
    data: {
      platform: "google",
      externalId: randomUUID(),
      rating: 5,
      reviewText: "Synthetic",
      sentiment: "positive",
      status: "draft_ready",
      responses: { create: { draftText: "original" } },
    },
    include: { responses: true },
  });
  reviewId = review.id;
  responseId = review.responses[0].id;
}
describe.skipIf(!testUrl)(
  "PostgreSQL publication integrity (actual routes and Prisma adapter)",
  () => {
    beforeAll(async () => {
      const url = new URL(testUrl!);
      if (
        !["localhost", "127.0.0.1"].includes(url.hostname) ||
        url.pathname != "/review_integrity"
      )
        throw new Error(
          "Use disposable localhost database named review_integrity",
        );
      admin = new PrismaClient({
        adapter: new PrismaPg({ connectionString: testUrl! }),
      });
      await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: testUrl! }, { schema }),
      });
      // pg can execute whole migration files, including function bodies.
      const { Client } = await import("pg");
      const sql = new Client({ connectionString: testUrl! });
      await sql.connect();
      await sql.query(`SET search_path TO "${schema}"`);
      for (const file of [
        "20260210200338_init",
        "20260911120000_add_response_publish_claim",
      ])
        await sql.query(
          await readFile(`prisma/migrations/${file}/migration.sql`, "utf8"),
        );
      const legacyIds = [randomUUID(), randomUUID(), randomUUID()];
      for (let i = 0; i < 3; i++) {
        await sql.query(
          `INSERT INTO reviews(id,platform,external_id,rating,review_text,sentiment,status) VALUES($1::uuid,'google',$1::text,5,'legacy','positive','approved')`,
          [legacyIds[i]],
        );
        await sql.query(
          `INSERT INTO responses(id,review_id,draft_text,approved_at,publish_claimed_at,posted_at) VALUES($1,$1,'legacy',now(),CASE WHEN $2::int > 0 THEN now() END,CASE WHEN $2::int = 2 THEN now() END)`,
          [legacyIds[i], i],
        );
      }
      await sql.query(
        await readFile(
          "prisma/migrations/20260913120000_publication_integrity/migration.sql",
          "utf8",
        ),
      );
      const legacy = await sql.query(
        "SELECT id, approved_at, publication_state FROM responses",
      );
      expect(legacy.rows.find((r) => r.id === legacyIds[0])).toMatchObject({
        approved_at: null,
        publication_state: "idle",
      });
      expect(legacy.rows.find((r) => r.id === legacyIds[1])).toMatchObject({
        publication_state: "reconciliation",
      });
      expect(legacy.rows.find((r) => r.id === legacyIds[2])).toMatchObject({
        publication_state: "posted",
      });
      await sql.end();
      vi.doMock("@/lib/db", () => ({ prisma: db }));
      store = (
        await import("../src/lib/reviews/prisma-store")
      ).createPrismaReviewStore();
      transitions = await import("../src/lib/reviews/transitions");
      process.env.NEXTAUTH_SECRET = "isolated-publication-integration-test";
      cookie = await createSessionToken();
    }, 30000);
    beforeEach(seed);
    afterAll(async () => {
      await db?.$disconnect();
      if (admin) {
        await admin.$executeRawUnsafe(
          `DROP SCHEMA IF EXISTS "${schema}" CASCADE`,
        );
        await admin.$disconnect();
      }
    });
    it("returns 409 for a stale edit after approval and publishes only the approval snapshot", async () => {
      await approval();
      const { PUT } =
        await import("../src/app/api/reviews/[id]/response/route");
      expect(
        (
          await PUT(
            request(
              "response",
              { responseId, text: "never-approved edit", version: 0 },
              "PUT",
            ),
            params(),
          )
        ).status,
      ).toBe(409);
      const google = { reply: vi.fn(async () => ({ ok: true })) };
      await publishApproved({ reviewId, responseId, store, google });
      expect(google.reply).toHaveBeenCalledWith(reviewId, "original");
    });
    it("rejects browser approval of an edited version through the actual approval route", async () => {
      await transitions.editDraft(
        reviewId,
        responseId,
        "new draft",
        0,
        "owner",
      );
      const { POST } =
        await import("../src/app/api/reviews/[id]/approve/route");
      expect(
        (await POST(request("approve", { responseId, version: 0 }), params()))
          .status,
      ).toBe(409);
      expect(
        (await store.getResponse(reviewId, responseId))?.approvedAt,
      ).toBeNull();
    });
    it("serializes concurrent edit and approval on PostgreSQL row locks", async () => {
      const results = await Promise.allSettled([
        approval(),
        transitions.editDraft(reviewId, responseId, "racing edit", 0, "owner"),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const row = await store.getResponse(reviewId, responseId);
      if (row?.approvedAt)
        expect(row).toMatchObject({
          approvedText: "original",
          finalText: "original",
        });
      else
        expect(row).toMatchObject({
          approvedText: null,
          finalText: "racing edit",
        });
    });
    it("serializes concurrent publishers into exactly one outbound call", async () => {
      await approval();
      const google = { reply: vi.fn(async () => ({ ok: true })) };
      await Promise.all([
        publishApproved({ reviewId, responseId, store, google }),
        publishApproved({ reviewId, responseId, store, google }),
      ]);
      expect(google.reply).toHaveBeenCalledTimes(1);
      expect(
        await db.auditLog.count({
          where: { reviewId, action: "response_posted" },
        }),
      ).toBe(1);
    });
    it("reject and regeneration cannot clear an in-flight fence or change approved content", async () => {
      await approval();
      let entered!: () => void, release!: () => void;
      const started = new Promise<void>((r) => (entered = r)),
        barrier = new Promise<void>((r) => (release = r));
      const google = {
        reply: vi.fn(async () => {
          entered();
          await barrier;
          return { ok: true };
        }),
      };
      const publishing = publishApproved({
        reviewId,
        responseId,
        store,
        google,
      });
      await started;
      try {
        const { POST } =
          await import("../src/app/api/reviews/[id]/reject/route");
        expect((await POST(request("reject"), params())).status).toBe(409);
        await expect(
          transitions.saveRegeneratedDraft(
            reviewId,
            1,
            { text: "unapproved", model: "test", tokensUsed: 1 },
            "owner",
          ),
        ).rejects.toThrow(/reconciliation/);
        await expect(
          store.markApproved(reviewId, responseId, "unapproved", 1, "owner"),
        ).rejects.toThrow(/reconciliation/);
      } finally {
        release();
      }
      await publishing;
      expect(google.reply).toHaveBeenCalledTimes(1);
    });
    it("never retries known external success after DB and audit failure, even years later", async () => {
      await approval();
      const google = { reply: vi.fn(async () => ({ ok: true })) };
      const failing = {
        ...store,
        markPosted: vi.fn(async () => {
          throw new Error("DB unavailable");
        }),
        writeAudit: vi.fn(async () => {
          throw new Error("audit unavailable");
        }),
      };
      await expect(
        publishApproved({ reviewId, responseId, store: failing, google }),
      ).rejects.toThrow();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2040-01-01"));
      try {
        expect(
          await publishApproved({ reviewId, responseId, store, google }),
        ).toMatchObject({ posted: false, alreadyClaimed: true });
      } finally {
        vi.useRealTimers();
      }
      expect(google.reply).toHaveBeenCalledTimes(1);
      expect(
        (await store.getResponse(reviewId, responseId))?.publicationState,
      ).toBe("reconciliation");
    });
    it("retains fencing after timeout and rejects stale worker completion tokens", async () => {
      await approval();
      const google = {
        reply: vi.fn(async () => {
          throw new Error("timeout after acceptance");
        }),
      };
      await expect(
        publishApproved({ reviewId, responseId, store, google }),
      ).rejects.toThrow(/reconciliation/);
      await publishApproved({ reviewId, responseId, store, google });
      expect(google.reply).toHaveBeenCalledTimes(1);
      await expect(
        store.markPosted(reviewId, responseId, randomUUID(), "stale-worker"),
      ).rejects.toThrow(/token/);
      expect(
        (await store.getResponse(reviewId, responseId))?.postedAt,
      ).toBeNull();
    });
    it("regeneration invalidates older approvals and refuses a stale generation result", async () => {
      const version = (
        await db.review.findUniqueOrThrow({ where: { id: reviewId } })
      ).version;
      await approval();
      await expect(
        transitions.saveRegeneratedDraft(
          reviewId,
          version,
          { text: "stale", model: "test", tokensUsed: 1 },
          "owner",
        ),
      ).rejects.toThrow(/changed/);
      const current = (
        await db.review.findUniqueOrThrow({ where: { id: reviewId } })
      ).version;
      await transitions.saveRegeneratedDraft(
        reviewId,
        current,
        { text: "fresh", model: "test", tokensUsed: 1 },
        "owner",
      );
      expect(
        (await store.getResponse(reviewId, responseId))?.approvedAt,
      ).toBeNull();
      await expect(
        publishApproved({
          reviewId,
          responseId,
          store,
          google: { reply: vi.fn() },
        }),
      ).rejects.toThrow(/not approved/);
    });
    it("database trigger refuses unconditional changes to approved text or clearing a fence", async () => {
      await approval();
      await expect(
        db.response.update({
          where: { id: responseId },
          data: { finalText: "never-approved" },
        }),
      ).rejects.toThrow(/immutable/);
      await store.claimForPublish(reviewId, responseId, "test");
      await expect(
        db.response.update({
          where: { id: responseId },
          data: { publishClaimedAt: null, approvedAt: null },
        }),
      ).rejects.toThrow(/reconciliation/);
    });
    it("rolls back approval when its audit write fails", async () => {
      await expect(
        store.markApproved(reviewId, responseId, "original", 0, "x".repeat(51)),
      ).rejects.toThrow();
      expect(
        (await store.getResponse(reviewId, responseId))?.approvedAt,
      ).toBeNull();
      expect((await store.getReview(reviewId))?.status).toBe("draft_ready");
    });
    it("preserves the fence across worker process death and a fresh Prisma client", async () => {
      await approval();
      await expect(
        promisify(execFile)(
          process.execPath,
          [
            "--import",
            "tsx",
            "tests/helpers/publish-and-exit.ts",
            testUrl!,
            schema,
            reviewId,
            responseId,
          ],
          { env: { ...process.env, DATABASE_URL: testUrl! } },
        ),
      ).rejects.toMatchObject({ code: 23 });
      const freshDb = new PrismaClient({
        adapter: new PrismaPg({ connectionString: testUrl! }, { schema }),
      });
      try {
        const freshStore = (
          await import("../src/lib/reviews/prisma-store")
        ).createPrismaReviewStore(freshDb);
        const google = { reply: vi.fn(async () => ({ ok: true })) };
        expect(
          await publishApproved({
            reviewId,
            responseId,
            store: freshStore,
            google,
          }),
        ).toMatchObject({ posted: false, alreadyClaimed: true });
        expect(google.reply).not.toHaveBeenCalled();
      } finally {
        await freshDb.$disconnect();
      }
    }, 15000);
    it("rolls back a claim whose attempt audit fails before touching Google", async () => {
      await approval();
      const google = { reply: vi.fn(async () => ({ ok: true })) };
      await expect(
        publishApproved({
          reviewId,
          responseId,
          store,
          google,
          actor: "x".repeat(51),
        }),
      ).rejects.toThrow();
      expect(google.reply).not.toHaveBeenCalled();
      expect(await store.getResponse(reviewId, responseId)).toMatchObject({
        publicationState: "idle",
        publishClaimedAt: null,
      });
    });
    it("rolls back completion but preserves the pre-I/O fence when its transaction fails", async () => {
      await approval();
      const google = { reply: vi.fn(async () => ({ ok: true })) };
      const failingStore = {
        ...store,
        markPosted: (rid: string, sid: string, token: string) =>
          store.markPosted(rid, sid, token, "x".repeat(51)),
      };
      await expect(
        publishApproved({ reviewId, responseId, store: failingStore, google }),
      ).rejects.toThrow(/unreconciled/);
      expect(await store.getResponse(reviewId, responseId)).toMatchObject({
        publicationState: "reconciliation",
        postedAt: null,
      });
      await publishApproved({ reviewId, responseId, store, google });
      expect(google.reply).toHaveBeenCalledTimes(1);
    });
  },
);
