/**
 * types.ts — input types for storage persist functions.
 * Designed to be populated from run-pipeline.ts after all stages complete.
 *
 * --------------------------------------------------------------------------
 * v5.1 (orchestrator) changes:
 *   RunStats gains two new fields:
 *     extractions_attempted — jobs where EXTRACT=1 was tried (ok or error)
 *     extractions_succeeded — jobs where extraction returned status "ok"
 *
 *   These are intentionally compile-breaking on callers that don't pass them,
 *   so run-pipeline.ts is forced to be updated. Both fields derive from the
 *   existing JobResult.extract_status field — no new in-loop counters needed.
 *
 *   finishRun() in persist.ts is updated to write these two columns.
 *   002_orchestrator.sql adds the columns to the DB.
 */

export interface RunRecord {
  run_id:      string;
  source:      string;
  started_at:  string;   // ISO timestamp
}

export interface RunStats {
  finished_at:           string;
  jobs_total:            number;
  jobs_passed:           number;
  jobs_gated:            number;
  jobs_covered:          number;
  extractions_attempted: number;  // jobs where extract was tried (ok | error)
  extractions_succeeded: number;  // jobs where extract returned "ok"
}

export interface JobRecord {
  job_id:          string;
  run_id:          string;
  source:          string;
  source_url?:     string | null;
  title?:          string | null;
  company?:        string | null;
  posted_at?:      string | null;
  scraped_at?:     string | null;
  description_raw?: string | null;
  meta?:           unknown;
  extracted?:      unknown;
  embedding?:      number[] | null;

  // Filter stage
  filter_verdict:  string;           // REJECT | PASS | DEDUP
  filter_reason?:  string | null;
  filter_flags:    string[];

  // Score stage (optional — only when EXTRACT=1)
  score?: {
    total:     number;
    skills:    number;
    semantic:  number;
    yoe:       number;
    seniority: number;
    location:  number;
  } | null;

  // Judge stage (optional)
  judge_verdict?:   string | null;
  judge_bucket?:    string | null;
  judge_reasoning?: string | null;
  judge_concerns?:  string[];

  // Cover letter stage (optional)
  cover_letter_content?: string | null;
  cover_letter_path?:    string | null;
  cover_letter_words?:   number | null;
  cover_letter_model?:   string | null;
}