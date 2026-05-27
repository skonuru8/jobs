-- 008_visa_enum.sql — normalize extracted/meta visa fields to the semantic enum.
-- No dedicated jobs.visa_sponsorship column exists in the live schema today.
-- We keep storage JSON-centric and migrate old boolean/null payloads in-place.

UPDATE jobs
SET extracted = jsonb_set(
  jsonb_set(
    COALESCE(extracted, '{}'::jsonb),
    '{visa_sponsorship}',
    to_jsonb(
      CASE
        WHEN extracted->>'visa_sponsorship' = 'true' THEN 'offered'
        WHEN extracted->>'visa_sponsorship' = 'false' THEN 'denied'
        WHEN extracted ? 'visa_sponsorship' THEN 'unmentioned'
        ELSE 'unmentioned'
      END
    ),
    true
  ),
  '{visa_quote}',
  COALESCE(extracted->'visa_quote', 'null'::jsonb),
  true
)
WHERE extracted IS NOT NULL;

UPDATE jobs
SET meta = jsonb_set(
  jsonb_set(
    COALESCE(meta, '{}'::jsonb),
    '{visa_sponsorship}',
    to_jsonb(
      CASE
        WHEN meta->>'visa_sponsorship' = 'true' THEN 'offered'
        WHEN meta->>'visa_sponsorship' = 'false' THEN 'denied'
        WHEN meta ? 'visa_sponsorship' THEN 'unmentioned'
        ELSE 'unmentioned'
      END
    ),
    true
  ),
  '{visa_quote}',
  COALESCE(meta->'visa_quote', 'null'::jsonb),
  true
)
WHERE meta IS NOT NULL AND meta ? 'visa_sponsorship';
