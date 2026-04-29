-- 001_initial.sql — initial Postgres schema for the job-hunter pipeline.
-- Idempotent: every statement uses IF NOT EXISTS so re-running is safe.
--
-- v4.1: NO CHANGES from your existing migration. Included in this changeset
-- only so the directory is self-contained.

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- -------------------------------------------------------------------------
-- runs — one row per pipeline execution
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS runs (
  run_id       TEXT        PRIMARY KEY,
  source       TEXT        NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at  TIMESTAMPTZ,
  jobs_total   INT,
  jobs_passed  INT,
  jobs_gated   INT,
  jobs_covered INT
);

-- -------------------------------------------------------------------------
-- jobs — one row per (job_id, run_id) pair
-- Same job seen in 2 runs → 2 rows, linked to different runs.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
  job_id          TEXT        NOT NULL,
  run_id          TEXT        NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  source          TEXT        NOT NULL,
  source_url      TEXT,
  title           TEXT,
  company         TEXT,
  posted_at       TIMESTAMPTZ,
  scraped_at      TIMESTAMPTZ,
  description_raw TEXT,
  meta            JSONB,
  extracted       JSONB,
  embedding       VECTOR(384),
  PRIMARY KEY (job_id, run_id)
);

CREATE INDEX IF NOT EXISTS jobs_run_idx    ON jobs(run_id);
CREATE INDEX IF NOT EXISTS jobs_source_idx ON jobs(source);
CREATE INDEX IF NOT EXISTS jobs_posted_idx ON jobs(posted_at);

-- HNSW index for fast approximate nearest-neighbour search.
-- Created here; populated automatically as rows are inserted.
CREATE INDEX IF NOT EXISTS jobs_embedding_hnsw
  ON jobs USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- -------------------------------------------------------------------------
-- filter_results — verdict from hard-filter stage
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS filter_results (
  job_id  TEXT NOT NULL,
  run_id  TEXT NOT NULL,
  verdict TEXT NOT NULL,   -- REJECT | PASS | DEDUP
  reason  TEXT,
  flags   JSONB NOT NULL DEFAULT '[]',
  PRIMARY KEY (job_id, run_id),
  FOREIGN KEY (job_id, run_id) REFERENCES jobs(job_id, run_id) ON DELETE CASCADE
);

-- -------------------------------------------------------------------------
-- scores — deterministic 5-component score
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scores (
  job_id    TEXT  NOT NULL,
  run_id    TEXT  NOT NULL,
  total     FLOAT NOT NULL,
  skills    FLOAT,
  semantic  FLOAT,
  yoe       FLOAT,
  seniority FLOAT,
  location  FLOAT,
  scored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (job_id, run_id),
  FOREIGN KEY (job_id, run_id) REFERENCES jobs(job_id, run_id) ON DELETE CASCADE
);

-- -------------------------------------------------------------------------
-- judge_verdicts — LLM judge output
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS judge_verdicts (
  job_id    TEXT NOT NULL,
  run_id    TEXT NOT NULL,
  verdict   TEXT,            -- STRONG | MAYBE | WEAK
  bucket    TEXT,            -- COVER_LETTER | RESULTS | REVIEW_QUEUE | ARCHIVE
  reasoning TEXT,
  concerns  JSONB NOT NULL DEFAULT '[]',
  model     TEXT,
  judged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (job_id, run_id),
  FOREIGN KEY (job_id, run_id) REFERENCES jobs(job_id, run_id) ON DELETE CASCADE
);

-- -------------------------------------------------------------------------
-- cover_letters — generated cover letter content + metadata
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cover_letters (
  job_id       TEXT NOT NULL,
  run_id       TEXT NOT NULL,
  content      TEXT,
  file_path    TEXT,
  word_count   INT,
  model        TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (job_id, run_id),
  FOREIGN KEY (job_id, run_id) REFERENCES jobs(job_id, run_id) ON DELETE CASCADE
);

-- -------------------------------------------------------------------------
-- seen_jobs — persistent backing store for cross-run exact dedup.
-- Redis is the primary dedup path (faster); this survives Redis flush.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS seen_jobs (
  source     TEXT        NOT NULL,
  job_id     TEXT        NOT NULL,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source, job_id)
);

CREATE INDEX IF NOT EXISTS seen_jobs_source_idx     ON seen_jobs(source);
CREATE INDEX IF NOT EXISTS seen_jobs_first_seen_idx ON seen_jobs(first_seen);