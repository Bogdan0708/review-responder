# Architecture: AI Review Responder

*Technical Design Document - 2026-02-10*

---

## System Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              EXTERNAL SERVICES                                │
├─────────────────────┬─────────────────────┬──────────────────────────────────┤
│   Google Business   │     TripAdvisor     │          LLM Provider            │
│   Profile API       │   (manual input)    │    (Claude / OpenAI / Local)     │
└─────────┬───────────┴──────────┬──────────┴───────────────┬──────────────────┘
          │                      │                          │
          ▼                      ▼                          ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                              REVIEW RESPONDER                                 │
├──────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Ingestion  │  │  AI Engine  │  │  Approval   │  │     Dashboard       │  │
│  │  Service    │──▶│  Service    │──▶│  Queue      │◀─▶│   (Next.js)         │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│         │                │                │                   │              │
│         └────────────────┴────────────────┴───────────────────┘              │
│                                    │                                          │
│                                    ▼                                          │
│                          ┌─────────────────┐                                  │
│                          │   PostgreSQL    │                                  │
│                          │   (reviews,     │                                  │
│                          │   responses,    │                                  │
│                          │   settings)     │                                  │
│                          └─────────────────┘                                  │
└──────────────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────┐
│  n8n Webhooks   │──▶ Notifications (Telegram, Email, etc.)
└─────────────────┘
```

---

## Component Specifications

### 1. Ingestion Service

**Responsibility:** Fetch and store reviews from external platforms.

| Aspect | Specification |
|--------|---------------|
| Runtime | Node.js worker (cron-triggered) |
| Google Polling | Every 15 minutes via GBP API |
| Webhook Endpoint | `POST /api/webhooks/review` for n8n/manual |
| Deduplication | Platform + external_review_id unique constraint |

**Data Model:**
```typescript
interface Review {
  id: string;                    // UUID
  platform: 'google' | 'tripadvisor' | 'manual';
  externalId: string;            // Platform's review ID
  authorName: string;
  rating: number;                // 1-5
  text: string;
  reviewDate: Date;
  ingestedAt: Date;
  sentiment: 'positive' | 'neutral' | 'negative';
  topics: string[];              // Extracted: ["sarmale", "service", "wait time"]
  status: 'pending' | 'draft_ready' | 'approved' | 'posted' | 'rejected';
}
```

### 2. AI Engine Service

**Responsibility:** Analyze reviews and generate responses.

| Aspect | Specification |
|--------|---------------|
| Primary LLM | Claude 3.5 Sonnet (via API) |
| Fallback | OpenAI GPT-4o-mini |
| Local Option | LM Studio (http://172.25.208.1:1234) |
| Latency Target | < 30 seconds |

**Process Flow:**
1. Receive new review from Ingestion Service
2. Extract sentiment (rating-based + text analysis)
3. Extract topics (dish names, service mentions)
4. Generate response using sentiment-appropriate prompt
5. Store draft and update review status

**Prompt Template Structure:**
```
SYSTEM: You are responding to reviews for Mitch from Transylvania, 
a Romanian street food restaurant. Use warm, friendly tone with 
a touch of Romanian hospitality. Be genuine, not corporate.

CONTEXT:
- Menu highlights: {menu_items}
- Brand voice: Warm, authentic, slightly playful

REVIEW:
Rating: {rating}/5
Author: {author_name}
Text: {review_text}
Extracted Topics: {topics}

INSTRUCTIONS:
- For 4-5 stars: Thank warmly, reference specific dish if mentioned, invite back
- For 3 stars: Thank, acknowledge concern, mention improvement commitment
- For 1-2 stars: Apologize sincerely, acknowledge issue, offer offline resolution
- Keep response 2-4 sentences
- Never be defensive
- Reference specific items they mentioned
```

### 3. Approval Queue

**Responsibility:** Manage review → response workflow.

| Status | Description | Next Actions |
|--------|-------------|--------------|
| `pending` | New review ingested | → Generate draft |
| `draft_ready` | AI draft created | → Approve / Edit / Reject / Regenerate |
| `approved` | Ready for posting | → Post to platform |
| `posted` | Successfully posted | Terminal state |
| `rejected` | Discarded | Terminal state |

**Auto-Approval Logic:**
```typescript
function shouldAutoApprove(review: Review, settings: Settings): boolean {
  if (!settings.autoApprovePositive) return false;
  // Use computed sentiment, not just rating
  if (review.sentiment !== 'positive') return false;
  if (review.rating < 4) return false;
  if (containsFoodSafetyKeywords(review.text)) return false;
  return true;
}
```

### 4. Dashboard (Next.js)

**Responsibility:** User interface for Mitch.

| Page | Features |
|------|----------|
| `/` | Stats overview, pending count, recent activity |
| `/reviews` | Filterable list (platform, sentiment, status) |
| `/reviews/[id]` | Detail view: review + draft + actions |
| `/settings` | Brand voice, API keys, auto-approve toggle |

**Tech Stack:**
- Next.js 14 (App Router)
- TailwindCSS + shadcn/ui
- Server Actions for mutations
- Simple session auth (single user)

### 5. Database Schema

```sql
-- Reviews table
CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform VARCHAR(20) NOT NULL,
  external_id VARCHAR(255) NOT NULL,
  author_name VARCHAR(255),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text TEXT NOT NULL,
  review_date TIMESTAMPTZ,
  ingested_at TIMESTAMPTZ DEFAULT NOW(),
  sentiment VARCHAR(10) NOT NULL,
  topics JSONB DEFAULT '[]',
  status VARCHAR(20) DEFAULT 'pending',
  UNIQUE(platform, external_id)
);

-- Responses table
CREATE TABLE responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID REFERENCES reviews(id),
  draft_text TEXT NOT NULL,
  final_text TEXT,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  llm_model VARCHAR(50),
  llm_tokens_used INTEGER
);

-- Settings table
CREATE TABLE settings (
  key VARCHAR(50) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit log
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID REFERENCES reviews(id),
  action VARCHAR(50) NOT NULL,
  actor VARCHAR(50) DEFAULT 'system',
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reviews_status ON reviews(status);
CREATE INDEX idx_reviews_platform ON reviews(platform);
CREATE INDEX idx_reviews_ingested ON reviews(ingested_at DESC);
```

---

## API Endpoints

### Internal API (Dashboard → Backend)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/reviews` | GET | List reviews (filterable) |
| `/api/reviews/[id]` | GET | Get single review + response |
| `/api/reviews/[id]/approve` | POST | Approve response |
| `/api/reviews/[id]/reject` | POST | Reject response |
| `/api/reviews/[id]/regenerate` | POST | Generate new draft |
| `/api/reviews/[id]/edit` | PUT | Update response text |
| `/api/settings` | GET/PUT | Read/update settings |
| `/api/stats` | GET | Dashboard statistics |

### Webhook API (External → System)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/webhooks/review` | POST | Ingest review from n8n |
| `/api/webhooks/google` | POST | Google push notification |

---

## Infrastructure

### Docker Compose Stack

```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://mitch:password@db:5432/reviews
      - CLAUDE_API_KEY=${CLAUDE_API_KEY}
      - GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
      - GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
    depends_on:
      - db

  db:
    image: postgres:16-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      - POSTGRES_USER=mitch
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=reviews

  # Optional: Local LLM proxy
  # llm-proxy:
  #   Forwards to LM Studio on Windows host

volumes:
  pgdata:
```

### n8n Integration

**Outbound webhooks (review-responder → n8n):**
- `new_review` - Triggered on ingestion
- `negative_review` - Triggered for 1-2 star reviews
- `response_posted` - Triggered after successful posting

**Inbound webhooks (n8n → review-responder):**
- `/api/webhooks/review` - Manual review submission

---

## Security Considerations

| Concern | Mitigation |
|---------|------------|
| API key exposure | Encrypted at rest, never in logs |
| Session hijacking | HTTP-only cookies, CSRF tokens |
| SQL injection | Parameterized queries via Prisma |
| XSS | React escaping + CSP headers |
| Rate limiting | 100 req/min per IP |

---

## Future Considerations (v2)

- Multi-language support (Romanian responses)
- Mobile-friendly PWA
- Review analytics dashboard
- Yelp read-only integration
- Multi-location support
