# Codex Review - 2026-02-10

**Reviewer:** GPT-5.2 Codex (via briny-haven session)
**Status:** ✅ Complete

---

## Summary

Overall solid architecture. Found gaps in operational concerns and error handling.

---

## Critical Issues

### 1. Missing Backup Strategy
**Severity:** High
**Location:** ARCHITECTURE.md - Infrastructure

No backup strategy defined for Postgres. Need:
- Daily snapshot mechanism
- Retention policy (7-14 days recommended)
- Cleanup jobs for old backups

**Recommendation:**
```yaml
# Add to docker-compose.yml
  backup:
    image: postgres:16-alpine
    volumes:
      - ./backups:/backups
    command: |
      sh -c 'pg_dump -h db -U mitch reviews > /backups/reviews-$$(date +%Y%m%d).sql'
```

### 2. Retry/Backoff Policy Undefined
**Severity:** High
**Location:** IMPLEMENTATION.md - Phase 4.1

Google posting and ingestion have "retry logic" mentioned but no specifics:
- Max retry count?
- Backoff strategy (exponential?)
- Alerting threshold?

**Recommendation:** Add to architecture:
```typescript
const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
  alertAfterFailures: 2  // n8n webhook on 2nd failure
};
```

---

## Medium Issues

### 3. Testing Gaps
**Location:** IMPLEMENTATION.md - Testing Checklist

Missing test cases:
- Webhook signature validation (prevent spoofed requests)
- OAuth token refresh flow (what happens when token expires?)
- Rate limit handling (429 responses)

### 4. Data Retention Undefined
**Location:** ARCHITECTURE.md - Database

No retention policy for:
- Old reviews (keep forever? 2 years?)
- Audit logs (prune after X days?)
- Token usage metrics

---

## Minor Issues

### 5. Sentiment Threshold Logic
Auto-approve checks `rating < 4` but sentiment extraction uses rating + text analysis. Should use computed sentiment, not just rating.

### 6. Environment Example Missing
`.env.example` mentioned in structure but not in Phase 1 deliverables.

---

## Recommended Additions to IMPLEMENTATION.md

```markdown
## Phase 5.5: Operational Concerns (NEW)

### Backup Strategy
- Daily pg_dump via cron container
- 14-day retention
- Weekly backup verification

### Monitoring
- Alert on 2+ consecutive API failures
- Alert on pending reviews > 50
- Daily digest of review stats

### Data Retention
- Reviews: Keep indefinitely
- Audit logs: 90 days
- Backups: 14 days
```

---

*Review complete. Plan is solid with these additions.*
