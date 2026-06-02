-- Allow fractional truth-distance scores for high-confidence naming variants.
ALTER TABLE fabrication_ledger
  ALTER COLUMN truth_distance_score TYPE NUMERIC
  USING truth_distance_score::numeric;
