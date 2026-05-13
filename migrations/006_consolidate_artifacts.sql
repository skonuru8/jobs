-- 006_consolidate_artifacts.sql — single applications folder layout support:
-- extended judge fields, drop artifact version columns, surrogate PK for cover_letters.

-- -------------------------------------------------------------------------
-- judge_verdicts — extended LLM output (nullable / defaults for old rows)
-- -------------------------------------------------------------------------
ALTER TABLE judge_verdicts ADD COLUMN IF NOT EXISTS confidence NUMERIC(3,2);
ALTER TABLE judge_verdicts ADD COLUMN IF NOT EXISTS key_matches JSONB DEFAULT '[]'::jsonb;
ALTER TABLE judge_verdicts ADD COLUMN IF NOT EXISTS gaps JSONB DEFAULT '[]'::jsonb;
ALTER TABLE judge_verdicts ADD COLUMN IF NOT EXISTS why_apply TEXT;
ALTER TABLE judge_verdicts ADD COLUMN IF NOT EXISTS tailoring_hints JSONB DEFAULT '{}'::jsonb;
ALTER TABLE judge_verdicts ADD COLUMN IF NOT EXISTS system_prompt_sha TEXT;

-- -------------------------------------------------------------------------
-- tailored_resumes — drop (job_id, version) uniqueness; multiple rows per job
-- -------------------------------------------------------------------------
ALTER TABLE tailored_resumes DROP CONSTRAINT IF EXISTS tailored_resumes_job_id_version_key;
ALTER TABLE tailored_resumes DROP COLUMN IF EXISTS version;

-- -------------------------------------------------------------------------
-- cover_letters — surrogate id PK (was job_id + version)
-- -------------------------------------------------------------------------
ALTER TABLE cover_letters ADD COLUMN IF NOT EXISTS id SERIAL;
ALTER TABLE cover_letters DROP CONSTRAINT IF EXISTS cover_letters_pkey;
ALTER TABLE cover_letters ADD CONSTRAINT cover_letters_pkey PRIMARY KEY (id);
ALTER TABLE cover_letters DROP COLUMN IF EXISTS version;

-- -------------------------------------------------------------------------
-- Indexes for latest row per job
-- -------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tailored_resumes_job_latest
  ON tailored_resumes(job_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cover_letters_job_latest
  ON cover_letters(job_id, generated_at DESC);
