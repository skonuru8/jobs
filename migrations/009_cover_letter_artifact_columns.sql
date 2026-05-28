-- cover_letters artifact columns. The original block was removed from 005 for
-- replay-safety and never re-added; insertCoverLetterArtifact() needs these.
ALTER TABLE cover_letters ADD COLUMN IF NOT EXISTS tex_path       TEXT;
ALTER TABLE cover_letters ADD COLUMN IF NOT EXISTS pdf_path       TEXT;
ALTER TABLE cover_letters ADD COLUMN IF NOT EXISTS meta_path      TEXT;
ALTER TABLE cover_letters ADD COLUMN IF NOT EXISTS prompt_sha     TEXT;
ALTER TABLE cover_letters ADD COLUMN IF NOT EXISTS canonical_sha  TEXT;
ALTER TABLE cover_letters ADD COLUMN IF NOT EXISTS input_tokens   INT;
ALTER TABLE cover_letters ADD COLUMN IF NOT EXISTS output_tokens  INT;
ALTER TABLE cover_letters ADD COLUMN IF NOT EXISTS compile_status TEXT NOT NULL DEFAULT 'ok';
ALTER TABLE cover_letters ADD COLUMN IF NOT EXISTS generated_by   TEXT NOT NULL DEFAULT 'pipeline';
ALTER TABLE cover_letters ADD COLUMN IF NOT EXISTS flags          TEXT[] DEFAULT '{}';
