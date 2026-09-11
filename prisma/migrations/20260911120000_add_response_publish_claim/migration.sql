-- Atomic publication claim for responses.
--
-- `publish_claimed_at` is taken by a single conditional UPDATE
-- (approved_at IS NOT NULL AND posted_at IS NULL AND publish_claimed_at IS NULL)
-- so that concurrent publishers cannot both call the Google reply API for the
-- same response. See src/lib/reviews/prisma-store.ts (claimForPublish).
ALTER TABLE "responses" ADD COLUMN "publish_claimed_at" TIMESTAMPTZ;

-- Speeds up the background worker's selection of publishable responses.
CREATE INDEX "responses_review_id_posted_at_idx" ON "responses" ("review_id", "posted_at");
