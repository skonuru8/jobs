/**
 * persist.ts — save pipeline results to Postgres.
 *
 * All functions are non-throwing: errors are logged and swallowed so a
 * DB outage never kills the pipeline (JSONL output is the fallback).
 *
 * Uses upserts (ON CONFLICT DO UPDATE) so re-running a JSONL replay
 * against an existing run doesn't cause constraint violations.
 *
 * --------------------------------------------------------------------------
 * v4.1 changes:
 *   1. saveJob: pool.connect() moved INSIDE the try block.
 *   2. formatErr() helper for AggregateError unwrapping.
 *   3. markStorageDisabled() / isStorageAvailable() flag.
 *
 * v5.1 (orchestrator) changes:
 *   4. finishRun: adds extractions_attempted + extractions_succeeded columns.
 *   5. updateHeartbeat: new function called every 60s by the orchestrator
 *      runner to keep last_heartbeat fresh. Non-throwing, same pattern as
 *      everything else. Only used by orchestrator — not exported from index
 *      until needed by other callers.
 *   6. markRunExitCode: called by orchestrator runner on child exit and by
 *      the ghost reaper for dead runs (exit_code = -1).
 */

import type { Pool, PoolClient } from "pg";

import { getPool } from "./db.js";
import type { RunRecord, RunStats, JobRecord } from "./types.js";
import type { LedgerEntryInput } from "../risk-map/types.js";

// ---------------------------------------------------------------------------
// Storage availability flag
// ---------------------------------------------------------------------------

let _disabled = false;

export function markStorageDisabled(reason?: string): void {
  if (_disabled) return;   // idempotent
  _disabled = true;
  if (reason) console.warn(`[storage] Disabled: ${reason}`);
}

export function isStorageAvailable(): boolean {
  return !_disabled;
}

/** Test helper — reset module state between tests. */
export function _resetDisabledForTesting(): void {
  _disabled = false;
}

// ---------------------------------------------------------------------------
// Error formatting
// ---------------------------------------------------------------------------

export function formatErr(e: unknown): string {
  if (!e) return "unknown error";
  const err = e as { message?: string; errors?: unknown[]; code?: string };

  if (err.message && err.message.trim()) {
    return err.code ? `[${err.code}] ${err.message}` : err.message;
  }
  if (Array.isArray(err.errors) && err.errors.length) {
    const inner = err.errors
      .map(x => (x as Error)?.message || String(x))
      .filter(Boolean)
      .join("; ");
    if (inner) return `AggregateError: ${inner}`;
  }
  return String(e);
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export async function saveRun(run: RunRecord): Promise<void> {
  if (_disabled) return;
  try {
    await getPool().query(
      `INSERT INTO runs (run_id, source, started_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (run_id) DO NOTHING`,
      [run.run_id, run.source, run.started_at],
    );
  } catch (e) {
    console.error("[storage] saveRun failed:", formatErr(e));
  }
}

export async function finishRun(runId: string, stats: RunStats): Promise<void> {
  if (_disabled) return;
  try {
    await getPool().query(
      `UPDATE runs
          SET finished_at            = $2,
              jobs_total             = $3,
              jobs_passed            = $4,
              jobs_gated             = $5,
              jobs_covered           = $6,
              extractions_attempted  = $7,
              extractions_succeeded  = $8
        WHERE run_id = $1`,
      [
        runId,
        stats.finished_at,
        stats.jobs_total,
        stats.jobs_passed,
        stats.jobs_gated,
        stats.jobs_covered,
        stats.extractions_attempted,
        stats.extractions_succeeded,
      ],
    );
  } catch (e) {
    console.error("[storage] finishRun failed:", formatErr(e));
  }
}

/**
 * updateHeartbeat — called every 60s by the orchestrator runner while a
 * child process is alive. Allows the ghost reaper to detect hard crashes
 * (OOM, SIGKILL) where the child exits without calling finishRun.
 *
 * Non-throwing: a missed heartbeat is acceptable — the reaper uses a 5min
 * stale window, so a single failed update won't incorrectly reap a live run.
 */
export async function updateHeartbeat(runId: string): Promise<void> {
  if (_disabled) return;
  try {
    await getPool().query(
      `UPDATE runs SET last_heartbeat = NOW() WHERE run_id = $1`,
      [runId],
    );
  } catch (e) {
    // Intentionally silent — a missed heartbeat is not a pipeline error
    console.error("[storage] updateHeartbeat failed:", formatErr(e));
  }
}

/**
 * markRunExitCode — called by:
 *   - orchestrator runner: on child process exit (exitCode = actual code)
 *   - ghost reaper: for dead runs (exitCode = -1, sets finished_at = NOW())
 *
 * The reaper path also sets finished_at because the child never called
 * finishRun — the run row would otherwise sit with finished_at IS NULL forever.
 */
export async function markRunExitCode(
  runId: string,
  exitCode: number,
  isGhost = false,
): Promise<void> {
  if (_disabled) return;
  try {
    if (isGhost) {
      await getPool().query(
        `UPDATE runs
            SET exit_code   = $2,
                finished_at = NOW()
          WHERE run_id = $1`,
        [runId, exitCode],
      );
    } else {
      await getPool().query(
        `UPDATE runs SET exit_code = $2 WHERE run_id = $1`,
        [runId, exitCode],
      );
    }
  } catch (e) {
    console.error("[storage] markRunExitCode failed:", formatErr(e));
  }
}

/**
 * getUnfinishedRuns — used by the ghost reaper to find runs whose
 * last_heartbeat has gone stale but finished_at is still NULL.
 *
 * Hits the partial index: runs_unfinished_idx ON runs(last_heartbeat)
 * WHERE finished_at IS NULL
 */
export async function getUnfinishedRuns(
  staleMinutes = 5,
): Promise<Array<{ run_id: string; source: string }>> {
  if (_disabled) return [];
  try {
    const result = await getPool().query<{ run_id: string; source: string }>(
      `SELECT run_id, source
         FROM runs
        WHERE finished_at   IS NULL
          AND last_heartbeat IS NOT NULL
          AND last_heartbeat < NOW() - ($1 || ' minutes')::INTERVAL`,
      [staleMinutes],
    );
    return result.rows;
  } catch (e) {
    console.error("[storage] getUnfinishedRuns failed:", formatErr(e));
    return [];
  }
}

/**
 * getRunStats — used by the orchestrator monitor to check extraction
 * success rates after a run completes.
 */
export async function getRunStats(runId: string): Promise<RunStats | null> {
  if (_disabled) return null;
  try {
    const result = await getPool().query<RunStats & { finished_at: string }>(
      `SELECT finished_at,
              jobs_total,
              jobs_passed,
              jobs_gated,
              jobs_covered,
              extractions_attempted,
              extractions_succeeded
         FROM runs
        WHERE run_id = $1`,
      [runId],
    );
    return result.rows[0] ?? null;
  } catch (e) {
    console.error("[storage] getRunStats failed:", formatErr(e));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Jobs — full pipeline result in one transactional call
//
// CRITICAL: pool.connect() MUST be inside the try block. If it throws
// (e.g. AggregateError when Postgres is down), the function must catch it
// rather than letting it escape and crash the pipeline's Promise.all.
//
// The 5 INSERTs (jobs / filter_results / scores / judge_verdicts / seen_jobs)
// ---------------------------------------------------------------------------

export async function saveJob(job: JobRecord): Promise<void> {
  if (_disabled) return;

  const pool = getPool();
  let client: PoolClient | undefined;

  try {
    client = await pool.connect();
    await client.query("BEGIN");

    // 1. jobs row
    const embeddingVal = job.embedding?.length
      ? `[${job.embedding.join(",")}]`
      : null;

    await client.query(
      `INSERT INTO jobs
         (job_id, run_id, source, source_url, title, company,
          posted_at, scraped_at, description_raw, meta, extracted, embedding)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::vector)
       ON CONFLICT (job_id, run_id) DO UPDATE
         SET extracted = EXCLUDED.extracted,
             embedding = EXCLUDED.embedding`,
      [
        job.job_id, job.run_id, job.source, job.source_url ?? null,
        job.title ?? null, job.company ?? null,
        job.posted_at ?? null, job.scraped_at ?? null,
        job.description_raw ?? null,
        job.meta ? JSON.stringify(job.meta) : null,
        job.extracted ? JSON.stringify(job.extracted) : null,
        embeddingVal,
      ],
    );

    // 2. filter_results
    await client.query(
      `INSERT INTO filter_results (job_id, run_id, verdict, reason, flags)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (job_id, run_id) DO UPDATE
         SET verdict = EXCLUDED.verdict,
             reason  = EXCLUDED.reason,
             flags   = EXCLUDED.flags`,
      [
        job.job_id, job.run_id,
        job.filter_verdict,
        job.filter_reason ?? null,
        JSON.stringify(job.filter_flags ?? []),
      ],
    );

    // 3. scores (only when score data present)
    if (job.score) {
      await client.query(
        `INSERT INTO scores
           (job_id, run_id, total, skills, semantic, yoe, seniority, location, scored_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW())
         ON CONFLICT (job_id, run_id) DO UPDATE
           SET total     = EXCLUDED.total,
               skills    = EXCLUDED.skills,
               semantic  = EXCLUDED.semantic,
               yoe       = EXCLUDED.yoe,
               seniority = EXCLUDED.seniority,
               location  = EXCLUDED.location`,
        [
          job.job_id, job.run_id,
          job.score.total, job.score.skills, job.score.semantic,
          job.score.yoe, job.score.seniority, job.score.location,
        ],
      );
    }

    // 4. judge_verdicts (only when judge ran)
    if (job.judge_verdict) {
      await client.query(
        `INSERT INTO judge_verdicts
           (job_id, run_id, verdict, bucket, reasoning, concerns, model, judged_at,
            confidence, key_matches, gaps, why_apply, tailoring_hints, system_prompt_sha)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7, NOW(),
            $8, $9::jsonb, $10::jsonb, $11, $12::jsonb, $13)
         ON CONFLICT (job_id, run_id) DO UPDATE
           SET verdict   = EXCLUDED.verdict,
               bucket    = EXCLUDED.bucket,
               reasoning = EXCLUDED.reasoning,
               concerns  = EXCLUDED.concerns,
               model     = COALESCE(EXCLUDED.model, judge_verdicts.model),
               confidence = EXCLUDED.confidence,
               key_matches = EXCLUDED.key_matches,
               gaps = EXCLUDED.gaps,
               why_apply = EXCLUDED.why_apply,
               tailoring_hints = EXCLUDED.tailoring_hints,
               system_prompt_sha = EXCLUDED.system_prompt_sha`,
        [
          job.job_id, job.run_id,
          job.judge_verdict,
          job.judge_bucket ?? null,
          job.judge_reasoning ?? null,
          JSON.stringify(job.judge_concerns ?? []),
          job.judge_model ?? null,
          job.judge_confidence ?? null,
          JSON.stringify(job.judge_key_matches ?? []),
          JSON.stringify(job.judge_gaps ?? []),
          job.judge_why_apply ?? null,
          JSON.stringify(job.judge_tailoring_hints ?? {}),
          job.judge_system_prompt_sha ?? null,
        ],
      );
    }

    // 5. cover_letters — rows inserted by insertCoverLetterArtifact() from pipeline / manual path

    // 6. seen_jobs (always — cross-run dedup backing store)
    await client.query(
      `INSERT INTO seen_jobs (source, job_id, first_seen)
       VALUES ($1, $2, NOW())
       ON CONFLICT (source, job_id) DO NOTHING`,
      [job.source, job.job_id],
    );

    await client.query("COMMIT");
  } catch (e) {
    if (client) {
      try { await client.query("ROLLBACK"); } catch { /* ignore rollback error */ }
    }
    console.error("[storage] saveJob failed:", formatErr(e));
  } finally {
    client?.release();
  }
}

// ---------------------------------------------------------------------------
// Tailored resume + cover letter rows (artifact pipeline)
// ---------------------------------------------------------------------------

/** True if this job already has a tailored resume or cover letter row. */
export async function jobHasAnyArtifacts(jobId: string): Promise<boolean> {
  if (_disabled) return false;
  try {
    const result = await getPool().query<{ has_any: boolean }>(
      `SELECT (
          EXISTS (SELECT 1 FROM tailored_resumes WHERE job_id = $1)
          OR EXISTS (SELECT 1 FROM cover_letters WHERE job_id = $1)
        ) AS has_any`,
      [jobId],
    );
    return Boolean(result.rows[0]?.has_any);
  } catch (e) {
    console.error("[storage] jobHasAnyArtifacts failed:", formatErr(e));
    return false;
  }
}

/** True only when the latest resume and cover rows both point at usable files. */
export async function jobHasCompleteArtifacts(jobId: string): Promise<boolean> {
  if (_disabled) return false;
  try {
    const result = await getPool().query<{ complete: boolean }>(
      `WITH latest_resume AS (
          SELECT tex_path, pdf_path, compile_status
            FROM tailored_resumes
           WHERE job_id = $1
           ORDER BY generated_at DESC NULLS LAST
           LIMIT 1
        ),
        latest_cover AS (
          SELECT tex_path, pdf_path, file_path, compile_status
            FROM cover_letters
           WHERE job_id = $1
           ORDER BY generated_at DESC NULLS LAST
           LIMIT 1
        )
        SELECT (
          EXISTS (
            SELECT 1 FROM latest_resume
             WHERE COALESCE(pdf_path, tex_path) IS NOT NULL
               AND compile_status <> 'failed'
          )
          AND EXISTS (
            SELECT 1 FROM latest_cover
             WHERE COALESCE(pdf_path, tex_path, file_path) IS NOT NULL
               AND compile_status <> 'failed'
          )
        ) AS complete`,
      [jobId],
    );
    return Boolean(result.rows[0]?.complete);
  } catch (e) {
    console.error("[storage] jobHasCompleteArtifacts failed:", formatErr(e));
    return false;
  }
}

export interface TailoredResumeInsert {
  job_id:          string;
  run_id:          string | null;
  tex_path:        string;
  pdf_path:        string | null;
  meta_path:       string;
  word_count:      number | null;
  model:           string;
  prompt_sha:      string;
  canonical_sha:   string;
  input_tokens:    number | null;
  output_tokens:   number | null;
  compile_status:  string;
  generated_by:    string;
  flags:           string[];
}

export async function insertTailoredResumeArtifact(row: TailoredResumeInsert): Promise<void> {
  if (_disabled) return;
  try {
    await getPool().query(
      `INSERT INTO tailored_resumes (
         job_id, run_id, tex_path, pdf_path, meta_path, word_count,
         model, prompt_sha, canonical_sha, input_tokens, output_tokens,
         compile_status, generated_by, flags, generated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::text[], NOW())`,
      [
        row.job_id,
        row.run_id,
        row.tex_path,
        row.pdf_path,
        row.meta_path,
        row.word_count,
        row.model,
        row.prompt_sha,
        row.canonical_sha,
        row.input_tokens,
        row.output_tokens,
        row.compile_status,
        row.generated_by,
        row.flags,
      ],
    );
  } catch (e) {
    console.error("[storage] insertTailoredResumeArtifact failed:", formatErr(e));
  }
}

export interface CoverLetterArtifactInsert {
  job_id:          string;
  run_id:          string;
  content:         string | null;
  file_path:       string | null;
  tex_path:        string | null;
  pdf_path:        string | null;
  meta_path:       string | null;
  word_count:      number | null;
  model:           string;
  prompt_sha:      string;
  canonical_sha:   string;
  input_tokens:    number | null;
  output_tokens:   number | null;
  compile_status:  string;
  generated_by:    string;
  flags:           string[];
}

export async function insertCoverLetterArtifact(row: CoverLetterArtifactInsert): Promise<void> {
  if (_disabled) return;
  try {
    await getPool().query(
      `INSERT INTO cover_letters (
         job_id, run_id, content, file_path, tex_path, pdf_path, meta_path,
         word_count, model, prompt_sha, canonical_sha, input_tokens, output_tokens,
         compile_status, generated_by, flags, generated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::text[], NOW())`,
      [
        row.job_id,
        row.run_id,
        row.content,
        row.file_path,
        row.tex_path,
        row.pdf_path,
        row.meta_path,
        row.word_count,
        row.model,
        row.prompt_sha,
        row.canonical_sha,
        row.input_tokens,
        row.output_tokens,
        row.compile_status,
        row.generated_by,
        row.flags,
      ],
    );
  } catch (e) {
    console.error("[storage] insertCoverLetterArtifact failed:", formatErr(e));
  }
}

/** Latest tailored resume + cover letter rows for a job_id (by generated_at). */
export async function getLatestArtifactsForJob(jobId: string): Promise<{
  resume: { tex_path: string | null; pdf_path: string | null; generated_at: string } | null;
  cover:  { tex_path: string | null; pdf_path: string | null; generated_at: string } | null;
}> {
  if (_disabled) return { resume: null, cover: null };
  try {
    const [rRes, cRes] = await Promise.all([
      getPool().query<{ tex_path: string; pdf_path: string | null; generated_at: string }>(
        `SELECT tex_path, pdf_path, generated_at
           FROM tailored_resumes WHERE job_id = $1
           ORDER BY generated_at DESC NULLS LAST LIMIT 1`,
        [jobId],
      ),
      getPool().query<{ tex_path: string | null; pdf_path: string | null; generated_at: string }>(
        `SELECT tex_path, pdf_path, generated_at
           FROM cover_letters WHERE job_id = $1
           ORDER BY generated_at DESC NULLS LAST LIMIT 1`,
        [jobId],
      ),
    ]);
    return {
      resume: rRes.rows[0] ?? null,
      cover:  cRes.rows[0] ?? null,
    };
  } catch (e) {
    console.error("[storage] getLatestArtifactsForJob failed:", formatErr(e));
    return { resume: null, cover: null };
  }
}

// ---------------------------------------------------------------------------
// Fabrication ledger
// ---------------------------------------------------------------------------

export async function insertLedgerEntries(rows: LedgerEntryInput[]): Promise<void> {
  if (rows.length === 0) return;
  if (_disabled) return;

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (const r of rows) {
      await client.query(`
        INSERT INTO fabrication_ledger (
          job_id, run_id, artifact_type, jd_skill, canonical_skill_found,
          generated_skill_or_claim, change_type, truth_distance_score,
          fabrication_risk, location, human_review_required
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [
        r.job_id, r.run_id, r.artifact_type, r.jd_skill, r.canonical_skill_found,
        r.generated_skill_or_claim, r.change_type, r.truth_distance_score,
        r.fabrication_risk, r.location, r.human_review_required,
      ]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[storage] insertLedgerEntries failed:", formatErr(e));
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Dedup helpers
// ---------------------------------------------------------------------------

export async function isSeenInDB(source: string, jobId: string): Promise<boolean> {
  if (_disabled) return false;
  try {
    const result = await getPool().query(
      `SELECT 1 FROM seen_jobs WHERE source = $1 AND job_id = $2 LIMIT 1`,
      [source, jobId],
    );
    return (result.rowCount ?? 0) > 0;
  } catch (e) {
    console.error("[storage] isSeenInDB failed:", formatErr(e));
    return false;
  }
}
