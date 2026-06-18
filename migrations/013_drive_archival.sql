-- 013_drive_archival.sql — Google Drive archival bookkeeping.

CREATE TABLE IF NOT EXISTS archived_artifacts (
  id              SERIAL PRIMARY KEY,
  job_id          TEXT        NOT NULL,
  run_id          TEXT,
  artifact_kind   TEXT        NOT NULL,
  local_path      TEXT        NOT NULL,
  drive_file_id   TEXT        NOT NULL,
  drive_folder_id TEXT        NOT NULL,
  bytes           BIGINT,
  archived_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, artifact_kind)
);

CREATE INDEX IF NOT EXISTS idx_archived_artifacts_job ON archived_artifacts (job_id);

ALTER TABLE labels ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
