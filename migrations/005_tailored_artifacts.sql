-- 005_tailored_artifacts.sql — tailored_resumes table.
-- Note: cover_letters versioning was originally added here but was superseded
-- by 006_consolidate_artifacts.sql (surrogate id PK, no version column).
-- The cover_letters block was removed to make this file replay-safe.

-- -------------------------------------------------------------------------
-- tailored_resumes — one row per (job_id, version)
-- job_id is not FK'd to jobs alone because jobs PK is (job_id, run_id).
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tailored_resumes (
  id              SERIAL PRIMARY KEY,
  job_id          TEXT NOT NULL,
  run_id          TEXT REFERENCES runs(run_id) ON DELETE SET NULL,
  version         INT NOT NULL,
  tex_path        TEXT NOT NULL,
  pdf_path        TEXT,
  meta_path       TEXT NOT NULL,
  word_count      INT,
  model           TEXT NOT NULL,
  prompt_sha      TEXT NOT NULL,
  canonical_sha   TEXT NOT NULL,
  input_tokens    INT,
  output_tokens   INT,
  compile_status  TEXT NOT NULL DEFAULT 'ok',
  generated_by    TEXT NOT NULL DEFAULT 'pipeline',
  flags           TEXT[] DEFAULT '{}',
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(job_id, version)
);

CREATE INDEX IF NOT EXISTS idx_tailored_resumes_job ON tailored_resumes(job_id);
CREATE INDEX IF NOT EXISTS idx_tailored_resumes_run ON tailored_resumes(run_id);
