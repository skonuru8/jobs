-- Align fabrication_ledger.run_id with runs.run_id (TEXT). UUID rejected
-- manual-<uuid> run ids.
ALTER TABLE fabrication_ledger
ALTER COLUMN run_id TYPE TEXT USING run_id::text;
