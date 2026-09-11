# Review Responder

Google review → AI draft (Claude → OpenAI → local fallback) → owner edit/approve → publish, with an audit trail and idempotent publishing. Next.js 16, Prisma 7, PostgreSQL.

**Status:** implementation evidence; not connected to a live Google Business Profile in this repo. The demo below runs entirely offline against synthetic data.

## Demo

```bash
npm install
npm run demo
```

`npm run demo` (`scripts/demo.ts`) loads 5 synthetic reviews for a fictional venue ("The Example Bistro") from `fixtures/reviews.json`, generates a draft reply for each with a local stub generator (no API keys, no network), and runs the approve → publish flow through the in-memory store and `FakeGoogle` client. It prints the full trace: draft generation, approval, publish, an idempotency check (approving an already-posted review a second time does not re-publish), a permission check (a `viewer` role is rejected), and the resulting audit trail.

It needs no accounts and no environment variables. Recorded output: [`docs/demo-output.txt`](docs/demo-output.txt) (asciinema was not available in the environment this was recorded in, so raw stdout was captured instead).

## How it works

1. A Google review is ingested (`src/lib/reviews/ingest.ts`, `src/lib/google/reviews.ts`).
2. A draft reply is generated with provider fallback — Claude → OpenAI → local LM Studio (`src/lib/ai/generate.ts`).
3. The owner reviews, edits, and approves the draft from the dashboard.
4. Approval and publishing invariants (role check, idempotency, audit trail) live in a single pure module, `src/lib/reviews/approve.ts`, independent of Prisma and the real Google API:
   - `approveAndPublish({ reviewId, text, actor, role, store, google })`
   - `store`: a small port (`getReview`, `getLatestResponse`, `markApproved`, `markPosted`, `writeAudit`) implemented once over Prisma (`src/lib/reviews/prisma-store.ts`) and once in memory (`src/lib/reviews/memory-store.ts`, used by tests and the demo).
   - `google`: `{ reply(reviewId, text): Promise<{ ok: boolean }> }`, implemented for real in `src/lib/google/respond.ts` and faked in `src/lib/google/__mocks__/fake-google.ts`.
   - Rules: only `owner`/`manager` roles may approve or publish; a response that is already posted is never posted again (`google.reply` is not called a second time for it); a failed `google.reply` never marks a response posted; every approve/publish attempt writes an audit entry.
5. The approve API route (`src/app/api/reviews/[id]/approve/route.ts`) calls `approveAndPublish` to record the approval; the background job (`postPendingGoogleResponses` in `src/lib/google/respond.ts`) calls the same module to publish approved-but-unposted responses to Google, so both paths share one set of invariants and one audit trail.

**Access control:** the dashboard uses a single owner password, so the API treats every authenticated caller as `owner`; the role check in `approveAndPublish` is enforced in the module and tested, and becomes meaningful once multi-user auth is added.

## Entry points

- `src/lib/ai/generate.ts` — provider-fallback draft generation
- `src/lib/reviews/approve.ts` — approval/publish invariants (pure, Prisma-free)
- `src/lib/google/respond.ts` — real Google publishing + the background job

## Tests

```bash
npm test        # vitest run — unit tests, Prisma mocked/replaced with the in-memory store
npx tsc --noEmit
```

- `tests/generate.test.ts` — provider fallback order (Claude → OpenAI → local) and the all-providers-fail case, with `@/lib/db` and the provider modules mocked.
- `tests/approval.test.ts` — idempotent publishing, role enforcement, and audit trail via the in-memory store and `FakeGoogle`.
- `tests/publish.test.ts` — batch publishing semantics mirroring `postPendingGoogleResponses` (one failure in a batch doesn't block the rest; an already-posted review is never re-published).

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
- `NEXTAUTH_SECRET`, `AUTH_PASSWORD` (dashboard auth)
- `N8N_WEBHOOK_BASE` (optional outbound webhooks)
- `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`, `CRON_SECRET` (optional)

## License

MIT — see [LICENSE](LICENSE).
