# Product Requirements Document: AI Review Responder

*Version 1.0 - 2026-02-10*

---

## Overview

Self-hosted AI-powered review response service for **Mitch from Transylvania**, a Romanian street food restaurant. Generates draft responses to customer reviews across Google Business Profile and TripAdvisor, with sentiment-aware routing and human approval workflows.

**Target user:** Mitch (restaurant owner, solo operator)
**Problem:** Manually responding to reviews is time-consuming. Delayed or missed responses hurt SEO ranking and customer perception.
**Solution:** AI drafts responses automatically. Mitch approves/edits via a simple dashboard. Google responses post automatically; TripAdvisor responses are queued for manual copy-paste.

---

## Goals

1. Reduce average review response time from days to hours
2. Maintain authentic brand voice (Romanian hospitality warmth)
3. Never auto-post responses to negative reviews without human approval
4. Keep operational cost under $20/month (LLM API costs)
5. Self-hosted, no vendor lock-in

## Non-Goals

- Fake review detection (out of scope for v1)
- Multi-location management
- Yelp integration (API too limited)
- Mobile app (web dashboard is sufficient)
- Customer analytics/reporting dashboards (v2)

---

## User Stories

### P0 - Must Have

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| US-01 | As Mitch, I want new Google reviews automatically ingested so I don't have to check manually | Reviews appear in dashboard within 15 minutes of posting |
| US-02 | As Mitch, I want AI-generated draft responses for each review | Draft generated within 60 seconds of ingestion |
| US-03 | As Mitch, I want to approve, edit, or reject draft responses | Dashboard shows pending drafts with approve/edit/reject buttons |
| US-04 | As Mitch, I want approved Google responses posted automatically | Response posted to Google within 5 minutes of approval |
| US-05 | As Mitch, I want negative reviews flagged for manual attention | Reviews with 1-2 stars marked as "requires review", never auto-approved |
| US-06 | As Mitch, I want TripAdvisor review drafts queued for manual posting | Draft response displayed with copy button and link to TripAdvisor |
| US-07 | As Mitch, I want the AI to reference specific dishes/items mentioned in reviews | Response includes dish names extracted from review text |

### P1 - Should Have

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| US-08 | As Mitch, I want to auto-approve positive reviews (4-5 stars) optionally | Toggle in settings: auto-approve positive reviews on/off |
| US-09 | As Mitch, I want notification when new reviews arrive | Webhook notification via n8n (email, Telegram, etc.) |
| US-10 | As Mitch, I want to customize the AI's brand voice | Editable system prompt with brand voice instructions |
| US-11 | As Mitch, I want to see review history and response status | List view with filters: pending, approved, posted, rejected |

### P2 - Nice to Have

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| US-12 | As Mitch, I want response analytics (avg response time, sentiment breakdown) | Simple stats on dashboard homepage |
| US-13 | As Mitch, I want to manually add reviews from any platform | Form to paste review text and generate a response |
| US-14 | As Mitch, I want LM Studio fallback for cost savings | Config option to route to local model endpoint |

---

## Functional Requirements

### FR-01: Review Ingestion

- **Google Business Profile:** Poll via GBP API every 15 minutes for new reviews (webhook if available via n8n, polling as fallback)
- **TripAdvisor:** Manual entry via dashboard form or n8n webhook (no API available)
- **n8n Webhook:** Accept incoming review data via HTTP POST at `/api/webhooks/review`
- Deduplicate reviews by platform + review ID
- Store raw review data (author name, rating, text, date, platform, review ID)

### FR-02: Sentiment Analysis & Classification

- Classify each review into: `positive` (4-5), `neutral` (3), `negative` (1-2)
- Extract key topics: dish names, service mentions, ambiance, wait time
- Flag food safety or health complaints for immediate escalation
- Sentiment and topics stored with review record

### FR-03: Response Generation

- Generate draft response using LLM (Claude API primary, OpenAI fallback)
- System prompt includes:
  - Restaurant brand voice (warm, Romanian hospitality)
  - Menu items and specialties for reference
  - Response length guidelines (2-4 sentences for positive, 3-5 for negative)
  - Specific instructions per sentiment tier
- Include extracted topic references in response
- Use reviewer's name if available

### FR-04: Approval Workflow

- **Auto-approve path:** Positive reviews (4-5 stars) when auto-approve is enabled
- **Manual review path:** All negative (1-2) and neutral (3) reviews always require manual approval
- **Actions:** Approve (post as-is), Edit (modify then approve), Reject (discard draft), Regenerate (new draft)
- **Escalation:** Negative reviews with food safety keywords trigger notification

### FR-05: Response Posting

- **Google:** Post approved response via GBP API. Retry up to 3 times on failure. Store post status.
- **TripAdvisor:** Display approved response with "Copy to Clipboard" button and direct link to the TripAdvisor review page. Mark as "posted" when Mitch confirms manual posting.

### FR-06: Dashboard

- **Review list:** Sortable/filterable table (platform, sentiment, status, date)
- **Review detail:** Full review text, AI draft, edit box, action buttons
- **Settings:** Brand voice prompt, auto-approve toggle, API keys, notification preferences
- **Simple stats header:** Total reviews, pending count, avg response time

### FR-07: Notifications (via n8n)

- Outbound webhook on events: new review ingested, negative review detected, response posted
- Payload includes: review summary, sentiment, draft response, action URL
- Mitch configures downstream (email, Telegram, etc.) in n8n

---

## Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Availability | 99% (self-hosted, acceptable for solo restaurant) |
| Response generation latency | < 30 seconds |
| Review ingestion delay | < 15 minutes from posting |
| Data retention | 2 years minimum |
| Concurrent users | 1-3 (Mitch + occasional staff) |
| Deployment | Docker Compose, single VPS |
| Database | PostgreSQL 16 |
| Security | API keys encrypted at rest, HTTPS, session auth |

---

## Platform Constraints

| Platform | API Support | Integration Method |
|----------|-------------|-------------------|
| Google Business Profile | Full (read reviews, post responses) | OAuth 2.0, REST API |
| TripAdvisor | None | Manual entry + copy-paste posting |
| Yelp | Read-only | Out of scope for v1 |

---

## Compliance & Safety

1. **Never auto-post** responses to reviews mentioning food safety, allergens, or health issues
2. **Never mention** specific employee names negatively in responses
3. **GDPR consideration:** Reviewer names are public on platforms; store only what's publicly visible
4. **Platform ToS:** Use only official APIs; no scraping
5. **Audit trail:** Log all response generations, edits, and postings with timestamps

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Review response rate | > 90% of reviews get responses | Reviews with status "posted" / total reviews |
| Average response time | < 12 hours | Time from review ingestion to response posted |
| AI draft acceptance rate | > 70% approved without edits | Approved-as-is / total approved |
| Monthly LLM cost | < $20 | API usage tracking |

---

## Out of Scope (Explicitly)

- Multi-language support (English only for v1; Romanian could be v2)
- Review solicitation / asking customers to leave reviews
- Competitor review monitoring
- Integration with POS systems
- Social media responses (Facebook, Instagram comments)
