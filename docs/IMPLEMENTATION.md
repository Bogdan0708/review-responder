# Implementation Plan: AI Review Responder

*Build Sequence - 2026-02-10*

---

## Overview

**Total Estimated Time:** 8-12 hours (solo dev)
**Tech Stack:** Next.js 14 + PostgreSQL + Prisma + TailwindCSS

---

## Phase 1: Foundation (2-3 hours)

### 1.1 Project Setup
```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir
npm install prisma @prisma/client
npm install -D @types/node
npx prisma init
```

### 1.2 Database Schema
- Create `prisma/schema.prisma` with Review, Response, Settings, AuditLog models
- Run `npx prisma migrate dev --name init`
- Seed initial settings (brand voice, auto-approve off)

### 1.3 Environment Setup
```env
DATABASE_URL="postgresql://mitch:password@localhost:5433/reviews"
CLAUDE_API_KEY="sk-ant-..."
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
NEXTAUTH_SECRET="..."
LM_STUDIO_URL="http://172.25.208.1:1234/v1"
```

### 1.4 Docker Setup
- Create `Dockerfile` (multi-stage build)
- Create `docker-compose.yml` (app + postgres)
- Test local deployment

**Deliverables:**
- [ ] Next.js app running
- [ ] PostgreSQL connected
- [ ] Docker compose working
- [ ] Environment configured

---

## Phase 2: Core Backend (2-3 hours)

### 2.1 Review Ingestion
```
src/
├── lib/
│   ├── db.ts              # Prisma client
│   ├── reviews/
│   │   ├── ingest.ts      # Create review record
│   │   └── dedupe.ts      # Check for duplicates
```

- `POST /api/webhooks/review` endpoint
- Deduplication logic
- Sentiment classification (rating-based)
- Topic extraction (simple keyword matching)

### 2.2 AI Response Generation
```
src/
├── lib/
│   ├── ai/
│   │   ├── generate.ts    # Main generation logic
│   │   ├── prompts.ts     # Prompt templates
│   │   ├── claude.ts      # Claude API client
│   │   ├── openai.ts      # OpenAI fallback
│   │   └── local.ts       # LM Studio client
```

- Claude API integration
- Prompt templates by sentiment
- Fallback chain: Claude → OpenAI → Local
- Token usage tracking

### 2.3 Review Processing Pipeline
```typescript
async function processNewReview(reviewId: string) {
  const review = await getReview(reviewId);
  const sentiment = classifySentiment(review);
  const topics = extractTopics(review);
  const draft = await generateResponse(review, sentiment, topics);
  await saveDraft(reviewId, draft);
  await updateStatus(reviewId, 'draft_ready');
  await notifyWebhook('new_review', review);
}
```

**Deliverables:**
- [ ] Webhook ingestion working
- [ ] AI generation working
- [ ] Pipeline end-to-end tested

---

## Phase 3: Dashboard UI (2-3 hours)

### 3.1 Layout & Components
```
src/
├── app/
│   ├── layout.tsx         # Root layout with nav
│   ├── page.tsx           # Dashboard home
│   ├── reviews/
│   │   ├── page.tsx       # Review list
│   │   └── [id]/
│   │       └── page.tsx   # Review detail
│   └── settings/
│       └── page.tsx       # Settings
├── components/
│   ├── ReviewList.tsx
│   ├── ReviewCard.tsx
│   ├── ResponseEditor.tsx
│   ├── StatsCard.tsx
│   └── ui/                # shadcn components
```

### 3.2 Review List Page
- Filterable table (status, platform, sentiment)
- Pagination
- Quick actions (approve, view)

### 3.3 Review Detail Page
- Full review display
- AI draft with edit capability
- Action buttons: Approve, Edit, Reject, Regenerate
- Audit history

### 3.4 Settings Page
- Brand voice editor (textarea for system prompt)
- Auto-approve toggle
- API key management (masked display)

**Deliverables:**
- [ ] Review list with filters
- [ ] Detail page with actions
- [ ] Settings page
- [ ] Responsive design

---

## Phase 4: Platform Integration (2-3 hours)

### 4.1 Google Business Profile
```
src/
├── lib/
│   ├── google/
│   │   ├── auth.ts        # OAuth flow
│   │   ├── reviews.ts     # Fetch reviews
│   │   └── respond.ts     # Post response
```

- OAuth 2.0 setup
- Review fetching (polling every 15 min)
- Response posting
- Error handling + retry logic

### 4.2 TripAdvisor (Manual)
- Manual input form in dashboard
- "Copy to Clipboard" for approved responses
- Link to TripAdvisor review page
- Manual "Mark as Posted" button

### 4.3 n8n Webhooks
```
src/
├── lib/
│   └── webhooks/
│       └── notify.ts      # Outbound webhook sender
```

Outbound events:
- `new_review` - review ingested
- `negative_review` - 1-2 star flagged
- `response_posted` - successfully posted

**Deliverables:**
- [ ] Google OAuth working
- [ ] Google review fetch working
- [ ] Google response posting working
- [ ] TripAdvisor manual workflow
- [ ] n8n webhooks configured

---

## Phase 5: Polish & Deploy (1-2 hours)

### 5.0 Retry & Backoff Configuration
Add to `src/lib/config/retry.ts`:
```typescript
export const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
  alertAfterFailures: 2  // Trigger n8n webhook on 2nd failure
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  config = RETRY_CONFIG
): Promise<T> {
  let lastError: Error;
  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      if (attempt >= config.alertAfterFailures - 1) {
        await notifyWebhook('api_failure', { attempt, error: lastError.message });
      }
      await new Promise(r => setTimeout(r, 
        config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt)
      ));
    }
  }
  throw lastError!;
}
```

### 5.1 Authentication
- Simple password auth (single user)
- Session management
- Protected routes

### 5.2 Error Handling
- API error boundaries
- User-friendly error messages
- Retry mechanisms

### 5.3 Cron Jobs
```bash
# Add to docker-compose or system cron
*/15 * * * * curl -X POST http://localhost:3000/api/cron/fetch-google
```

### 5.4 Production Deployment
- Build Docker image
- Deploy to VPS / home server
- Configure reverse proxy (nginx/caddy)
- SSL certificate

### 5.5 Testing
- Manual E2E test flow
- Test with real Google Business Profile
- Test n8n notification flow

**Deliverables:**
- [ ] Auth working
- [ ] Error handling complete
- [ ] Cron configured
- [ ] Deployed and accessible
- [ ] SSL enabled

---

## Phase 6: Operational Concerns (1 hour)

### 6.1 Backup Strategy
Add to `docker-compose.yml`:
```yaml
  backup:
    image: postgres:16-alpine
    volumes:
      - ./backups:/backups
      - pgdata:/var/lib/postgresql/data:ro
    environment:
      - PGPASSWORD=password
    entrypoint: []
    command: |
      sh -c 'while true; do
        pg_dump -h db -U mitch reviews > /backups/reviews-$$(date +%Y%m%d).sql
        find /backups -name "*.sql" -mtime +14 -delete
        sleep 86400
      done'
    depends_on:
      - db
```

### 6.2 Data Retention Policy
| Data Type | Retention |
|-----------|-----------|
| Reviews | Indefinite |
| Responses | Indefinite |
| Audit logs | 90 days |
| Backups | 14 days |

Add cleanup cron:
```sql
-- Run daily via /api/cron/cleanup
DELETE FROM audit_log WHERE created_at < NOW() - INTERVAL '90 days';
```

### 6.3 Monitoring & Alerting
Trigger n8n webhooks for:
- 2+ consecutive API failures
- Pending reviews > 50 (review backlog)
- Daily digest: reviews received, responses posted, avg response time

**Deliverables:**
- [ ] Backup container running
- [ ] Cleanup cron working
- [ ] Alerting webhooks configured

---

## Testing Checklist

### Happy Path
- [ ] Submit review via webhook → draft generated
- [ ] Approve draft → posted to Google
- [ ] Edit draft → save → approve → posted
- [ ] TripAdvisor review → copy → mark posted

### Edge Cases
- [ ] Duplicate review ignored
- [ ] 1-star review flagged, not auto-approved
- [ ] API failure → retry works
- [ ] Very long review handled
- [ ] Empty review text handled

### Security
- [ ] Unauthenticated access blocked
- [ ] API keys not exposed in UI
- [ ] XSS attempt blocked
- [ ] SQL injection attempt blocked
- [ ] Webhook signature validation working
- [ ] OAuth token refresh on expiry
- [ ] Rate limit handling (429 response)

---

## File Structure (Final)

```
review-responder/
├── docs/
│   ├── RESEARCH.md
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   └── IMPLEMENTATION.md
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── reviews/
│   │   │   ├── webhooks/
│   │   │   ├── settings/
│   │   │   └── cron/
│   │   ├── reviews/
│   │   ├── settings/
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   ├── lib/
│   │   ├── db.ts
│   │   ├── ai/
│   │   ├── google/
│   │   └── webhooks/
│   └── types/
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── docker-compose.yml
├── Dockerfile
├── .env.example
└── README.md
```

---

## Next Step

→ **Phase 3: Verify Plan** - Send to Codex & Gemini for review
