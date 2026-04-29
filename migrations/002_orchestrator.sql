-- 002_orchestrator.sql — adds orchestrator-managed columns to the runs table.
-- Idempotent: uses IF NOT EXISTS / DO NOTHING patterns throughout.
--
-- New columns:
--   exit_code             INT           — child process exit code; NULL while running
--   last_heartbeat        TIMESTAMPTZ   — updated every 60s by the orchestrator runner;
--                                         NULL for runs started before this migration
--   extractions_attempted INT DEFAULT 0 — jobs where extract was attempted (ok or error)
--   extractions_succeeded INT DEFAULT 0 — jobs where extract returned status "ok"
--
-- Existing rows get sensible defaults: exit_code NULL (unknown), heartbeat NULL,
-- extraction counts 0. Historical 0/0 is harmless — the monitor only looks at the
-- current run, not historical ones.
--
-- Partial index on last_heartbeat WHERE finished_at IS NULL: the ghost reaper query
-- hits this index directly. At most a handful of rows ever have finished_at IS NULL
-- so this index is tiny and lookup is trivial.

ALTER TABLE runs ADD COLUMN IF NOT EXISTS exit_code             INT;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS last_heartbeat        TIMESTAMPTZ;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS extractions_attempted INT DEFAULT 0;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS extractions_succeeded INT DEFAULT 0;

CREATE INDEX IF NOT EXISTS runs_unfinished_idx
  ON runs(last_heartbeat)
  WHERE finished_at IS NULL;