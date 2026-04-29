/**
 * pgvector.ts — cross-site semantic dedup via pgvector cosine similarity.
 *
 * After scoring (when we have the job's embedding), this checks whether
 * any job in the last N days has cosine similarity >= threshold.
 *
 * This catches the same role posted on multiple sites (Dice + LinkedIn)
 * where the job_id is different but the JD text is nearly identical.
 *
 * Returns the matching job_id if a duplicate is found, null otherwise.
 *
 * Non-throwing: returns null on any error (treat as no duplicate).
 */

import { getPool } from "@/storage/db.js";

const DEFAULT_THRESHOLD  = 0.88;
const DEFAULT_LOOKBACK_DAYS = 7;

/**
 * Find a semantically similar job already in the DB from a recent run.
 *
 * @param embedding    Float32 vector (384-dim, bge-small-en-v1.5)
 * @param currentRunId Exclude jobs from the current run (avoid self-match)
 * @param threshold    Cosine similarity floor (default 0.88)
 * @param lookbackDays How many days back to search (default 7)
 * @returns Matching job_id or null
 */
export async function findSemanticDuplicate(
  embedding:    number[],
  currentRunId: string,
  threshold:    number = DEFAULT_THRESHOLD,
  lookbackDays: number = DEFAULT_LOOKBACK_DAYS,
): Promise<string | null> {
  if (!embedding.length) return null;

  try {
    const pool = getPool();
    const vec  = `[${embedding.join(",")}]`;

    const res = await pool.query<{ job_id: string; similarity: number }>(
      `SELECT job_id,
              1 - (embedding <=> $1::vector) AS similarity
         FROM jobs
        WHERE run_id   <> $2
          AND posted_at > NOW() - INTERVAL '${lookbackDays} days'
          AND embedding IS NOT NULL
          AND 1 - (embedding <=> $1::vector) >= $3
        ORDER BY embedding <=> $1::vector
        LIMIT 1`,
      [vec, currentRunId, threshold],
    );

    if (res.rows.length > 0) {
      return res.rows[0].job_id;
    }
    return null;
  } catch {
    return null;   // DB unavailable or no embedding → no dedup
  }
}
