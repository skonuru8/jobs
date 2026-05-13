-- 005_tailored_artifacts.sql — tailored resumes + versioned cover letters
-- Idempotent where possible.

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

-- -------------------------------------------------------------------------
-- cover_letters — add versioning + artifact paths
-- -------------------------------------------------------------------------
ALTER TABLE cover_letters ADD COLUMN IF NOT EXISTS version          INT;
ALTER TABLE cover_letters ADD COLUMN IF NOT EXISTS tex_path         TEXT;
ALTER TABLE cover_letters ADD COLUMN IF NOT EXISTS pdf_path         TEXT;
ALTER TABLE cover_letters ADD COLUMN IF NOT EXISTS meta_path        TEXT;
ALTER TABLE cover_letters ADD COLUMN IF NOT EXISTS prompt_sha       TEXT;
ALTER TABLE cover_letters ADD COLUMN IF NOT EXISTS canonical_sha    TEXT;
ALTER TABLE cover_letters ADD COLUMN IF NOT EXISTS input_tokens     INT;
ALTER TABLE cover_letters ADD COLUMN IF NOT EXISTS output_tokens    INT;
ALTER TABLE cover_letters ADD COLUMN IF NOT EXISTS compile_status   TEXT NOT NULL DEFAULT 'ok';
ALTER TABLE cover_letters ADD COLUMN IF NOT EXISTS generated_by     TEXT NOT NULL DEFAULT 'pipeline';
ALTER TABLE cover_letters ADD COLUMN IF NOT EXISTS flags            TEXT[] DEFAULT '{}';

UPDATE cover_letters cl
SET version = sub.v
FROM (
  SELECT job_id, run_id,
         ROW_NUMBER() OVER (
           PARTITION BY job_id
           ORDER BY generated_at NULLS LAST, run_id
         )::INT AS v
  FROM cover_letters
  WHERE version IS NULL
) sub
WHERE cl.job_id = sub.job_id AND cl.run_id = sub.run_id AND cl.version IS NULL;

UPDATE cover_letters SET version = 1 WHERE version IS NULL;

ALTER TABLE cover_letters DROP CONSTRAINT IF EXISTS cover_letters_pkey;

ALTER TABLE cover_letters ADD CONSTRAINT cover_letters_pkey PRIMARY KEY (job_id, version);

CREATE INDEX IF NOT EXISTS idx_cover_letters_job ON cover_letters(job_id);
