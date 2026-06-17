-- 012_regeneration_reason.sql
-- Tracks why a given artifact row was generated when it replaces a prior attempt.
-- NULL = first generation (no prior attempt). Non-null values include:
--   "manual_force"                — operator forced regeneration without a known prior failure
--   "previous_resume_gen_failed"  — prior tailored_resumes row for same job had resume_gen_failed flag
--   "previous_cover_gen_failed"   — prior cover_letters row for same job had cover_letter_gen_failed flag
--   "previous_both_failed"        — both resume and cover letter failed in prior attempt
--   "explicit:<reason>"           — caller-supplied reason string

ALTER TABLE tailored_resumes ADD COLUMN IF NOT EXISTS regeneration_reason TEXT DEFAULT NULL;
ALTER TABLE cover_letters    ADD COLUMN IF NOT EXISTS regeneration_reason TEXT DEFAULT NULL;
