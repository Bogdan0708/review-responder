# Research: AI Review Responder for Restaurants

*Phase 1 Research - 2026-02-10*

---

## Key Findings

### Platform API Support

| Platform | Review Response API | Notes |
|----------|---------------------|-------|
| **Google Business Profile** | ✅ Yes | Requires enterprise approval, OAuth |
| **TripAdvisor** | ❌ No | Manual only, no public API |
| **Yelp** | ⚠️ Limited | Read-only for most uses |

**Implication:** Focus on Google first, TripAdvisor via manual queue/notification.

### Best Practices (Industry Consensus)

1. **AI Draft → Human Approval → Post** (never fully automated for negative reviews)
2. **Sentiment-based routing:**
   - Positive → Auto-approve option
   - Neutral → Quick review
   - Negative → Always human review, escalation path
3. **Personalization is critical:**
   - Reference specific dishes mentioned
   - Use customer name if available
   - Acknowledge specific feedback points
4. **Response timing:**
   - < 24h for negative reviews
   - < 48h for positive reviews
   - Consistency matters for SEO

### Existing Solutions (Competitors)

| Tool | Pricing | Key Feature |
|------|---------|-------------|
| ReviuAI | $49-199/mo | Fake review detection |
| Popmenu | $149+/mo | Multi-site management |
| Otter (TryOtter) | $99+/mo | Restaurant-focused |
| Ovation | Enterprise | Sentiment analysis |

**Gap:** No self-hosted, open-source option with LLM customization.

### Technical Architecture (Recommended)

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Google GBP  │────▶│   Ingestion │────▶│   AI Gen    │
│ (webhook)   │     │   Service   │     │   Service   │
└─────────────┘     └─────────────┘     └─────────────┘
                           │                   │
                           ▼                   ▼
                    ┌─────────────┐     ┌─────────────┐
                    │  Database   │◀────│  Approval   │
                    │  (reviews)  │     │   Queue     │
                    └─────────────┘     └─────────────┘
                                              │
                                              ▼
                                       ┌─────────────┐
                                       │  Post Back  │
                                       │  to Google  │
                                       └─────────────┘
```

### Response Templates (Sentiment-Based)

**Positive (4-5 stars):**
> "Thank you so much for your kind words, [NAME]! We're thrilled you enjoyed [SPECIFIC_MENTION]. We can't wait to welcome you back!"

**Neutral (3 stars):**
> "Thank you for your feedback, [NAME]. We're glad you [POSITIVE_POINT] and appreciate you letting us know about [IMPROVEMENT_AREA]. We're always working to improve!"

**Negative (1-2 stars):**
> "Thank you for taking the time to share your experience, [NAME]. We're truly sorry to hear about [ISSUE]. This isn't the standard we aim for. Please reach out to [EMAIL] so we can make this right."

### Legal/Compliance Notes

- Never auto-post responses to food safety complaints
- Never mention specific employees negatively
- GDPR: Don't store customer names without consent
- Platform ToS: Don't scrape, use official APIs only

---

## Recommendations for Mitch

1. **Start with Google Business Profile** - Has API, highest impact
2. **Queue system** for TripAdvisor - Manual posting, AI-generated drafts
3. **Brand voice training** - Romanian hospitality warmth + professionalism
4. **n8n integration** - Webhook ingestion, approval notifications
5. **LM Studio fallback** - Use local models for cost savings on high volume

---

## Next Steps

→ **Phase 2: Plan** - Create PRD and architecture spec
