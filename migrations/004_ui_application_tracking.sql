-- 004_ui_application_tracking.sql
-- Adds application tracking columns to labels for the review UI.
-- Idempotent; safe to re-run.

ALTER TABLE labels ADD COLUMN IF NOT EXISTS application_status TEXT;
ALTER TABLE labels ADD COLUMN IF NOT EXISTS applied_at         TIMESTAMPTZ;

ALTER TABLE labels DROP CONSTRAINT IF EXISTS labels_application_status_check;
ALTER TABLE labels ADD CONSTRAINT labels_application_status_check
  CHECK (application_status IN ('applied', 'skipped', 'apply_later'));

CREATE INDEX IF NOT EXISTS labels_application_status_idx
  ON labels(application_status);
