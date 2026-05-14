CREATE TABLE IF NOT EXISTS fabrication_ledger (
  id                       SERIAL PRIMARY KEY,
  job_id                   TEXT NOT NULL REFERENCES jobs(job_id),
  run_id                   UUID,
  artifact_type            TEXT NOT NULL CHECK (artifact_type IN ('resume', 'cover_letter')),

  jd_skill                 TEXT,
  canonical_skill_found    TEXT,
  generated_skill_or_claim TEXT NOT NULL,
  change_type              TEXT NOT NULL,
  truth_distance_score     INT NOT NULL,
  fabrication_risk         TEXT NOT NULL,
  location                 TEXT NOT NULL DEFAULT 'unknown',
  human_review_required    BOOLEAN NOT NULL DEFAULT FALSE,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fab_ledger_job
  ON fabrication_ledger(job_id);
CREATE INDEX IF NOT EXISTS idx_fab_ledger_run
  ON fabrication_ledger(run_id);
CREATE INDEX IF NOT EXISTS idx_fab_ledger_risk
  ON fabrication_ledger(fabrication_risk, change_type);
CREATE INDEX IF NOT EXISTS idx_fab_ledger_created
  ON fabrication_ledger(created_at DESC);
