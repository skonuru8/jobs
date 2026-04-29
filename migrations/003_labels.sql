-- 003_labels.sql — manual labeling table for scoring calibration (M9).
-- One row per (job_id, run_id) the user has labeled.
-- FK cascade: if the underlying job row is deleted, its label goes too.

CREATE TABLE IF NOT EXISTS labels (
  job_id     TEXT        NOT NULL,
  run_id     TEXT        NOT NULL,
  label      TEXT        NOT NULL CHECK (label IN ('yes', 'maybe', 'no')),
  notes      TEXT,
  labeled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (job_id, run_id),
  FOREIGN KEY (job_id, run_id) REFERENCES jobs(job_id, run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS labels_label_idx ON labels(label);

