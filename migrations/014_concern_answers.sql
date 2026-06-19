-- 014_concern_answers.sql — deterministic answers to judge concerns
ALTER TABLE judge_verdicts
  ADD COLUMN IF NOT EXISTS concern_answers jsonb NOT NULL DEFAULT '[]'::jsonb;
