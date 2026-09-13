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
   - `approveResponse({ reviewId, responseId, text, version, actor, role, store })` binds the approval to one immutable response id and the exact text approved, and returns `{ responseId, approvedText }`.
   - `publishApproved({ reviewId, responseId, store, google })` publishes only the immutable `approvedText` snapshot. It never accepts caller text.
   - HTTP approval and editing require the response ID and version shown in the browser. Stale requests return 409. Approval, edit, rejection, regeneration and ingestion use a PostgreSQL lock on the review row, conditional version/state writes and transactional audit entries.
   - Only an owner or manager can approve. The old automatic-approval setting is retired; all generated drafts require explicit approval.
5. **Publication has a durable fence.** Before calling Google, one database transaction records a unique attempt token, sets the response and review to `reconciliation`, and writes the attempt audit. Concurrent publishers, edits, rejection and regeneration cannot clear this fence, even for another response on the same review. Completion requires the matching token. The Google write adapter makes one PUT attempt with no automatic retry. This is a conservative at-most-one-attempt policy, not a promise of exactly-once external delivery.
6. **Reconciliation survives crashes and database outages.** Any held claim, timeout, unsuccessful result or process death remains blocked indefinitely. There is no TTL takeover. Even failure to write a follow-up audit cannot erase the pre-I/O fence. Inspect `publication_state = 'reconciliation'`, not only failure audit entries. The [rollout and reconciliation runbook](docs/PUBLICATION-ROLLOUT.md) explains legacy approval invalidation, coordinated migration and manual recovery.

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
- `tests/publish.test.ts` — publication fencing, immutable snapshots, ambiguous external results and no automatic adapter/cron retries, using the real worker and a mocked Prisma client.
- `tests/publication-postgres.test.ts` — opt-in real PostgreSQL interleavings and migration tests through actual routes/adapters, plus worker process death. Set `RR_TEST_DATABASE_URL` to a disposable localhost PostgreSQL database named `review_integrity`; the suite creates and drops its own schema. CI supplies PostgreSQL and runs these tests (an ordinary local `npm test` skips them without that variable).

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
- `N8N_WEBHOOK_BASE` (optional outbound webhooks)
- `CRON_SECRET` (required to use `/api/cron/*`; the endpoints return 503 when it is unset), `WEBHOOK_SECRET` (required to use `/api/webhooks/*`, sent as `x-webhook-secret`; 503 when unset)
- `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS` (optional)

## License

MIT — see [LICENSE](LICENSE).
