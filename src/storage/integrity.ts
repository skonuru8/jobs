// storage/src/integrity.ts
import { getPool, isStorageAvailable } from "./index.js";

export interface IntegrityReport {
  source:           string;
  redis_seen_count: number;
  pg_seen_count:    number;
  pg_jobs_count:    number;
  orphans_in_redis: string[];   // marked seen, no jobs row → bad
  orphans_in_pg:    string[];   // jobs row, not in seen_jobs → bad
}

/**
 * Verify Redis ↔ Postgres dedup state agrees.
 * Cheap: one SCAN, two COUNTs, two anti-joins.
 */
export async function verifyIntegrity(
  source:        string,
  redisSeenIds:  string[],   // pass result of SCAN seen:{source}:*
): Promise<IntegrityReport> {
  if (!isStorageAvailable()) {
    return { source, redis_seen_count: redisSeenIds.length, pg_seen_count: 0,
             pg_jobs_count: 0, orphans_in_redis: [], orphans_in_pg: [] };
  }

  const pool = getPool();

  const seenCountRes = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text FROM seen_jobs WHERE source = $1`, [source]);
  const jobsCountRes = await pool.query<{ count: string }>(
    `SELECT COUNT(DISTINCT job_id)::text FROM jobs WHERE source = $1`, [source]);

  // Orphans: Redis has it, Postgres seen_jobs doesn't
  const redisOrphans = redisSeenIds.length === 0 ? { rows: [] as Array<{ job_id: string }> }
    : await pool.query<{ job_id: string }>(
      `SELECT id AS job_id FROM unnest($1::text[]) AS id
        WHERE NOT EXISTS (SELECT 1 FROM seen_jobs s
                           WHERE s.source = $2 AND s.job_id = id)`,
      [redisSeenIds, source]);

  // Orphans: Postgres jobs row exists, no seen_jobs row
  const pgOrphans = await pool.query<{ job_id: string }>(
    `SELECT DISTINCT j.job_id FROM jobs j
      WHERE j.source = $1
        AND NOT EXISTS (SELECT 1 FROM seen_jobs s
                         WHERE s.source = j.source AND s.job_id = j.job_id)
      LIMIT 50`, [source]);

  return {
    source,
    redis_seen_count: redisSeenIds.length,
    pg_seen_count:    parseInt(seenCountRes.rows[0].count, 10),
    pg_jobs_count:    parseInt(jobsCountRes.rows[0].count, 10),
    orphans_in_redis: redisOrphans.rows.map(r => r.job_id),
    orphans_in_pg:    pgOrphans.rows.map(r => r.job_id),
  };
}

export function formatReport(r: IntegrityReport): string {
  const ok = r.orphans_in_redis.length === 0 && r.orphans_in_pg.length === 0;
  if (ok) {
    return `[integrity] ✓ ${r.source}: redis=${r.redis_seen_count} pg_seen=${r.pg_seen_count} pg_jobs=${r.pg_jobs_count}`;
  }
  const lines = [`[integrity] ⚠ ${r.source}: drift detected`];
  if (r.orphans_in_redis.length) {
    lines.push(`  ${r.orphans_in_redis.length} job_ids marked seen in Redis but missing from Postgres`);
    lines.push(`  → markSeen ran but saveJob didn't. Sample: ${r.orphans_in_redis.slice(0, 3).join(", ")}`);
  }
  if (r.orphans_in_pg.length) {
    lines.push(`  ${r.orphans_in_pg.length} jobs in Postgres missing from seen_jobs`);
    lines.push(`  → saveJob ran but markSeen path skipped. Sample: ${r.orphans_in_pg.slice(0, 3).join(", ")}`);
  }
  return lines.join("\n");
}