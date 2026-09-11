# Review Responder

Google review → AI draft (Claude → OpenAI → local fallback) → owner edit/approve → publish, with an audit trail and idempotent publishing. Next.js 16, Prisma 7, PostgreSQL.

**Status:** implementation evidence; not connected to a live Google Business Profile in this repo. The demo below runs entirely offline against synthetic data.

## Demo

```bash
npm install
npm run demo
```

`npm run demo` (`scripts/demo.ts`) loads 5 synthetic reviews for a fictional venue ("The Example Bistro") from `fixtures/reviews.json`, generates a draft reply for each with a local stub generator (no API keys, no network), and runs the approve → publish flow through the in-memory store and `FakeGoogle` client. It prints the full trace: draft generation, approval, publish, an idempotency check (publishing an already-posted response a second time does not re-publish), a concurrency check (two workers racing on the same approved response produce exactly one `google.reply` call and one `response_posted` audit entry), a permission check (a `viewer` role is rejected), and the resulting audit trail.

It needs no accounts and no environment variables. Recorded output: [`docs/demo-output.txt`](docs/demo-output.txt) (asciinema was not available in the environment this was recorded in, so raw stdout was captured instead).

## How it works

1. A Google review is ingested (`src/lib/reviews/ingest.ts`, `src/lib/google/reviews.ts`).
2. A draft reply is generated with provider fallback — Claude → OpenAI → local LM Studio (`src/lib/ai/generate.ts`).
3. The owner reviews, edits, and approves the draft from the dashboard.
4. **Approving and publishing are two separate operations**, both in `src/lib/reviews/approve.ts` — a module independent of Prisma and the real Google API:
   - `approveResponse({ reviewId, responseId, text, actor, role, store })` binds the approval to one immutable response id and the exact text approved, and returns `{ responseId, approvedText }`.
   - `publishApproved({ reviewId, responseId, store, google })` publishes the **stored** approved text of that exact response id, re-read from storage *after* the publication claim is held. It has no `text` parameter. The guarantee it gives is precise: the text published for a response id is the text that was approved for that response id — approved text is immutable until the review is rejected (which clears `approvedAt`), the edit endpoint refuses to change an approved response (409), and a draft regenerated after approval cannot take its place.
   - `store`: a small port (`getReview`, `getLatestResponse`, `getResponse`, `markApproved`, `markPosted`, `claimForPublish`, `releaseClaim`, `writeAudit`) implemented once over Prisma (`src/lib/reviews/prisma-store.ts`) and once in memory (`src/lib/reviews/memory-store.ts`, used by tests and the demo).
   - `google`: `{ reply(reviewId, text): Promise<{ ok: boolean }> }`, implemented for real in `src/lib/google/respond.ts` and faked in `src/lib/google/__mocks__/fake-google.ts`.
   - Rules: only `owner`/`manager` roles may approve; only an approved, unposted response may be published; a failed `google.reply` never marks a response posted and releases the claim so a later run retries; every approve/publish attempt writes an audit entry.
5. **Publication is claimed atomically.** Before calling Google, `publishApproved` takes the claim through `store.claimForPublish(reviewId, responseId)` — in Prisma a conditional `updateMany` (`approvedAt NOT NULL`, `postedAt NULL`, `publishClaimedAt NULL` → set `publishClaimedAt`). Postgres serialises the competing updates, so exactly one caller sees `count === 1` and reaches Google; concurrent callers return `{ ok: true, alreadyClaimed: true }` without calling it. Two overlapping cron runs therefore produce one `google.reply` call and one `response_posted` audit entry. A claim held longer than `PUBLISH_CLAIM_TTL_MS` (default 15 minutes) is treated as stale — the mark of a run that died between claiming and recording the post — and is taken over by the next run, which writes a `response_post_claim_reclaimed` audit entry; without that, one crash would wedge a review forever. Only after the claim is held does the publisher re-read the row, so a write racing the claim cannot slip into the reply unnoticed.
6. **Reconciliation.** If Google accepts the reply but the following database write fails, the claim is deliberately *not* released (releasing it would risk a second reply) and an audit entry `response_post_unreconciled` records the review id, response id, published text and error. That row stays `postedAt = NULL` with `publishClaimedAt` set, and needs a manual check against the Google reply before `posted_at` is set by hand — searching the audit log for `response_post_unreconciled` lists exactly the affected responses.
7. The approve API route (`src/app/api/reviews/[id]/approve/route.ts`) calls `approveResponse` with the latest response id and its stored text, and — only when called with `?publish=1` — `publishApproved` for that same id; otherwise publication is left to the background job (`postPendingGoogleResponses` in `src/lib/google/respond.ts`), which selects explicit `{ reviewId, responseId }` pairs and publishes those pinned ids. Both paths share one set of invariants and one audit trail.

**Session lifetime and revocation:** a token is valid for `SESSION_MAX_AGE` (7 days) from the moment it was issued, and that is checked on the server. Logging out clears the browser cookie but does **not** invalidate the token itself — anyone holding a copy of the cookie value could still use it until it expires. There are two server-side revocation levers: bump `SESSION_VERSION` (the value is embedded in every token and compared on verify) to invalidate all outstanding sessions cheaply, or rotate `NEXTAUTH_SECRET`, which does the same by making every existing signature unverifiable. Single-owner deployment, so "all sessions" is the honest granularity here; per-session revocation would need a session store.

**Access control:** the dashboard uses a single owner password, so a valid session *is* the owner — but "valid" is verified, not assumed. The session cookie is an HMAC-SHA256-signed payload carrying an issued-at timestamp (`src/lib/session.ts`, Web Crypto so the Edge middleware can verify it); `readSession` checks the signature **and** that `issuedAt + SESSION_MAX_AGE` has not passed, and returns the session the actor/role are derived from. The middleware (`src/middleware.ts`) verifies every non-public request and answers `401 application/json` for `/api/*` and a redirect to `/login` for pages; the approve, reject, regenerate and response-edit route handlers verify the session again themselves (defence in depth) rather than trusting the presence of a cookie. `/api/auth/*` and `/login` are public; `/api/cron/*` and `/api/webhooks/*` are exempt from the session check because their callers are machines, and instead require their own shared secret (`Authorization: Bearer $CRON_SECRET`, `x-webhook-secret: $WEBHOOK_SECRET`) — an unset secret fails closed with a 503, never open.

## Entry points

- `src/lib/ai/generate.ts` — provider-fallback draft generation
- `src/lib/reviews/approve.ts` — approval/publish invariants (pure, Prisma-free)
- `src/lib/session.ts` — signed, expiring session tokens (Edge-safe, shared by middleware and routes)
- `src/middleware.ts` — the authentication boundary
- `src/lib/google/respond.ts` — real Google publishing + the background job

## Tests

```bash
npm test        # vitest run — unit tests, Prisma mocked/replaced with the in-memory store
npx tsc --noEmit
```

- `tests/generate.test.ts` — provider fallback order (Claude → OpenAI → local) and the all-providers-fail case, with `@/lib/db` and the provider modules mocked.
- `tests/session.test.ts` — signature verification, tampering, server-side expiry, and `SESSION_VERSION` revocation.
- `tests/machine-routes.test.ts` — the cron and webhook shared-secret guards through the real route handlers: unset secret → 503, wrong secret → 401, correct secret → the work runs.
- `tests/response-edit-route.test.ts` — approve → edit is refused (409) through the real routes, the cron then publishes the approved text, and rejecting the review clears the approval so the draft becomes editable again.
- `tests/middleware.test.ts` — the real `middleware` over real `NextRequest`s: absent, forged, expired and valid sessions; 401 JSON for `/api/*`, redirect for pages, public paths still reachable.
- `tests/approve-route.test.ts` — the real `POST /api/reviews/[id]/approve` handler with Prisma mocked: absent/forged/expired sessions get 401 and write nothing; a valid session approves the latest response with the actor taken from the session; `?publish=1` publishes the approved text.
- `tests/approval.test.ts` — approval bound to one response id, role enforcement, publish-what-was-approved, failure handling and audit trail via the in-memory store and `FakeGoogle`.
- `tests/publish.test.ts` — publication invariants (two concurrent publishes → one `google.reply` and one `response_posted`; regeneration after approval; a stale claim reclaimed while a fresh one is left alone; the post-claim re-read; Google failure releases the claim; Google success with a failed database write audits `response_post_unreconciled`) plus the real `postPendingGoogleResponses` worker driven over a mocked Prisma client, so the selection logic and the Prisma adapter's claim are exercised.

## Run locally

This needs Docker (PostgreSQL) and does **not** need real Google/Claude/OpenAI credentials to boot — it will just have nothing to fetch or publish.

```bash
cp .env.example .env   # fill in the values you have; see the list below
docker compose up -d
npm install
npm run db:generate
npm run db:migrate
npm run dev
```

Environment variables (see `.env.example` for the full list, values only — never commit real ones):

- `DATABASE_URL`
- `CLAUDE_API_KEY`, `OPENAI_API_KEY`, `LM_STUDIO_URL` (AI providers — any subset can be left empty; unset providers are skipped in the fallback chain)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_ACCOUNT_ID`, `GOOGLE_LOCATION_ID` (Google Business Profile — optional for local exploration; required to actually ingest/publish real reviews)
- `NEXTAUTH_SECRET` (HMAC key for session tokens — rotating it invalidates every session), `AUTH_PASSWORD` (dashboard auth), `SESSION_VERSION` (optional, defaults to `1`; bump it to revoke every issued session)
- `PUBLISH_CLAIM_TTL_MS` (optional, default `900000` — how long a publication claim may be held before another run may take it over)
- `N8N_WEBHOOK_BASE` (optional outbound webhooks)
- `CRON_SECRET` (required to use `/api/cron/*`; the endpoints return 503 when it is unset), `WEBHOOK_SECRET` (required to use `/api/webhooks/*`, sent as `x-webhook-secret`; 503 when unset)
- `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS` (optional)

## License

MIT — see [LICENSE](LICENSE).
