BEGIN;
-- Stop all old app/cron workers before migration; old code must not resume.
ALTER TABLE reviews ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE responses ADD COLUMN version INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN approved_text TEXT,
 ADD COLUMN publication_token UUID,
 ADD COLUMN publication_state VARCHAR(20) NOT NULL DEFAULT 'idle';
-- Historical approvals may have raced edits: never infer that current text was approved.
-- Posted rows are retained; unposted claims are quarantined permanently for reconciliation.
UPDATE responses SET publication_token = CASE WHEN publish_claimed_at IS NOT NULL OR posted_at IS NOT NULL THEN gen_random_uuid() ELSE NULL END,
 publication_state = CASE WHEN posted_at IS NOT NULL THEN 'posted'
 WHEN publish_claimed_at IS NOT NULL THEN 'reconciliation' ELSE 'idle' END,
 approved_text = CASE WHEN posted_at IS NOT NULL OR publish_claimed_at IS NOT NULL
 THEN COALESCE(final_text, draft_text) ELSE NULL END,
 approved_at = CASE WHEN posted_at IS NOT NULL OR publish_claimed_at IS NOT NULL
 THEN approved_at ELSE NULL END;
UPDATE reviews r SET status = CASE
 WHEN EXISTS(SELECT 1 FROM responses s WHERE s.review_id=r.id AND s.publication_state='reconciliation') THEN 'reconciliation'
 WHEN EXISTS(SELECT 1 FROM responses s WHERE s.review_id=r.id AND s.posted_at IS NOT NULL) THEN 'posted'
 WHEN r.status='approved' THEN 'draft_ready' ELSE r.status END;
ALTER TABLE responses ADD CONSTRAINT publication_state_valid CHECK (publication_state IN ('idle','reconciliation','posted'));
-- DB backstop against a stale unconditional edit and clearing a durable fence.
CREATE FUNCTION protect_response_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.approved_at IS NOT NULL AND NEW.approved_at IS NOT NULL AND
 (NEW.draft_text IS DISTINCT FROM OLD.draft_text OR NEW.final_text IS DISTINCT FROM OLD.final_text OR
 NEW.approved_text IS DISTINCT FROM OLD.approved_text) THEN
 RAISE EXCEPTION 'Approved content is immutable';
 END IF;
 IF OLD.posted_at IS NOT NULL AND (NEW.posted_at IS DISTINCT FROM OLD.posted_at OR NEW.publication_state <> 'posted') THEN
 RAISE EXCEPTION 'Posted response is immutable';
 END IF;
 IF OLD.publication_state <> 'idle' AND
 (NEW.publication_state = 'idle' OR NEW.publication_token IS DISTINCT FROM OLD.publication_token OR
 NEW.publish_claimed_at IS DISTINCT FROM OLD.publish_claimed_at OR NEW.approved_at IS DISTINCT FROM OLD.approved_at) THEN
 RAISE EXCEPTION 'Publication fence requires manual reconciliation';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_response_publication BEFORE UPDATE ON responses
 FOR EACH ROW EXECUTE FUNCTION protect_response_publication();

COMMIT;
