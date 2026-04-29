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
// The 6 INSERTs (jobs / filter_results / scores / judge_verdicts /
// cover_letters / seen_jobs) are unchanged from the original.
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
           (job_id, run_id, verdict, bucket, reasoning, concerns, model, judged_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7, NOW())
         ON CONFLICT (job_id, run_id) DO UPDATE
           SET verdict   = EXCLUDED.verdict,
               bucket    = EXCLUDED.bucket,
               reasoning = EXCLUDED.reasoning,
               concerns  = EXCLUDED.concerns`,
        [
          job.job_id, job.run_id,
          job.judge_verdict,
          job.judge_bucket ?? null,
          job.judge_reasoning ?? null,
          JSON.stringify(job.judge_concerns ?? []),
          null,  // model not currently passed through JobRecord
        ],
      );
    }

    // 5. cover_letters (only when cover letter was generated)
    if (job.cover_letter_path) {
      await client.query(
        `INSERT INTO cover_letters
           (job_id, run_id, content, file_path, word_count, model, generated_at)
         VALUES ($1,$2,$3,$4,$5,$6, NOW())
         ON CONFLICT (job_id, run_id) DO UPDATE
           SET content    = EXCLUDED.content,
               file_path  = EXCLUDED.file_path,
               word_count = EXCLUDED.word_count`,
        [
          job.job_id, job.run_id,
          job.cover_letter_content ?? null,
          job.cover_letter_path,
          job.cover_letter_words ?? null,
          job.cover_letter_model ?? null,
        ],
      );
    }

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