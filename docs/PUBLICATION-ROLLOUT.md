# Publication integrity rollout and reconciliation

This change is not safe for a mixed-version rolling deployment. The old publisher reclaims claims by time and the old reject route clears them. Stop every old app instance, cron caller and background publisher before migration; no old process may resume. The repository's only GitHub workflow is CI and Docker starts `server.js` without running migrations. External hosting hooks must be inspected separately before merging/deploying.

## What changes

- Response versions identify exactly what the browser reviewed. Edit and approve requests without `responseId` and a nonnegative integer `version` return 400; stale versions return 409. Update API callers together with the UI.
- Approval stores an immutable text snapshot and its audit in one transaction. PostgreSQL serializes every transition on the parent review, including asynchronous initial draft generation and regeneration.
- An attempt token and `reconciliation` state commit with an audit **before** any Google write. Completion updates only the matching token. The state also covers a live in-flight call; it does not prove the external write succeeded.
- There is no automatic retry or claim expiry, including on network errors or 5xx responses. A lost response can mean the write succeeded. Crashes before the actual request conservatively need reconciliation too.
- Rejection/regeneration may invalidate an unclaimed approval. Once attempted or posted, they are refused. The old nonfunctional auto-approve option is retired; every new draft requires a person to approve it.

## Coordinated rollout

1. Disable the external schedule invoking `/api/cron/fetch-google` and any other publisher. Stop all app processes, including background ingestion/generation. For the supplied local Compose topology: `docker compose stop app`. Check the hosting service/process inventory and wait for all old workers to exit; stopping this one container is not proof that other instances stopped.
2. Take a database backup and verify that it can be restored into a separate disposable database. Retain it before applying schema changes. Do not restore an old backup over a database after replies were attempted: that would erase durable fences and permit another attempt.
3. From a checkout of the reviewed commit, use Node 22, run `npm ci`, `npx prisma generate`, and build the new application. Keep public ingress and the cron schedule disabled.
4. With `DATABASE_URL` deliberately set to the intended database, run `npx prisma migrate deploy` from the build/operator environment (the minimal runtime image does not promise to include the Prisma CLI). This applies `20260913120000_publication_integrity` after the prior migrations.
5. Review migration results before restarting any publisher. **All unposted/unclaimed legacy approvals are cleared** and their approved reviews become `draft_ready`: the previous race means current text cannot be assumed to be what was approved. Posted rows remain posted. Every unposted legacy claim becomes `reconciliation` regardless of age; a token is assigned so it can be finalized safely. For legacy claimed/posted rows, the copied text is historical current content, not newly verified proof of approval. Audit/Google evidence must resolve discrepancies.
6. Start only the new version (`docker compose up -d --build app` for the supplied topology), verify session protection and review state, and have an owner/manager inspect and reapprove cleared drafts. Never reapprove quarantined rows to retry them. Re-enable the schedule only after the application version and migration are verified.
7. On failure, keep publishers disabled. Roll forward a corrected version; do not run old code against the new schema or restore a backup that predates possible Google writes.

## Find work needing reconciliation

Use a read-only query; the durable row is authoritative even if a failure audit could not be written or old audit entries were removed by retention:

```sql
SELECT r.id AS review_id, r.external_id, s.id AS response_id,
       s.publication_token, s.publish_claimed_at, s.approved_text,
       s.approved_at, s.posted_at
FROM reviews r JOIN responses s ON s.review_id = r.id
WHERE s.publication_state = 'reconciliation';
```

Stop/confirm termination of the worker holding the token before making a recovery decision. Inspect the current Google reply through a read-only GET or the Business Profile UI and compare text and timestamps against the stored snapshot and available audits. A read error or absent/lagging reply is not proof that a write was never accepted. Do not send another PUT as a probe.

If independent evidence confirms the exact expected reply exists, an operator can finalize that **same response/token** using the store's `markPosted(reviewId, responseId, token, actor)` method. This transaction locks the review, conditionally marks the response posted, updates the review and writes the audit; no Google write occurs. Preserve the evidence in an operator record. Legacy copied text may not be a trustworthy approval: verify the actual approval audit and obtain owner review if needed.

If the outcome remains unknown, retain the quarantine. If a reply is confirmed absent and a new attempt is explicitly authorized after every old worker has terminated, prepare a separately reviewed recovery migration/workflow. There is deliberately no automatic claim reset or retry endpoint, and a database trigger prevents ordinary updates from clearing the fence. Never disable that trigger simply to make the queue run again.

## Verification limits

The tests use a disposable PostgreSQL 16 database, synthetic records and mocked Google I/O. They exercise database locks, actual route handlers, a child process killed after the durable claim, stale tokens, migration of old rows and a simulated accepted PUT followed by connection loss. They do not publish to Google, migrate a production database, verify hosting hooks or establish production deployment.
