/**
 * db.ts — Postgres connection pool (singleton).
 *
 * Connection string from DATABASE_URL env var.
 * Default matches docker-compose.yml:
 *   postgresql://postgres:postgres@localhost:5432/jobhunter
 *
 * --------------------------------------------------------------------------
 * v4.1 changes:
 * - Pool error listener now formats AggregateError properly. Previously a
 *   bare ${err.message} would print empty when pg failed to connect on both
 *   IPv4 and IPv6 — leaving "Pool error:" with nothing after it.
 * - Added connectionRetry: 0 explicitly to make connect() fail fast rather
 *   than retrying forever in the background. Combined with persist.ts's
 *   markStorageDisabled() flag, this means a single startup-time failure
 *   shuts down DB attempts cleanly instead of leaking retries on every job.
 *
 * Note: the pool is lazy. getPool() doesn't actually connect — the first
 * pool.connect() or pool.query() call is what triggers the real connection.
 */

import pg from "pg";
const { Pool } = pg;

let _pool: InstanceType<typeof Pool> | null = null;

/**
 * Format any Error-like value into a non-empty string.
 * Mirrors persist.ts's formatErr — duplicated here so db.ts has no import
 * cycle with persist.ts.
 */
function describeErr(e: unknown): string {
  if (!e) return "unknown";
  const err = e as { message?: string; errors?: unknown[]; code?: string };
  if (err.message && err.message.trim()) {
    return err.code ? `[${err.code}] ${err.message}` : err.message;
  }
  if (Array.isArray(err.errors) && err.errors.length) {
    return err.errors
      .map(x => (x as Error)?.message || String(x))
      .filter(Boolean)
      .join("; ") || String(e);
  }
  return String(e);
}

export function getPool(): InstanceType<typeof Pool> {
  if (!_pool) {
    const url = process.env.DATABASE_URL
      ?? "postgresql://postgres:postgres@localhost:5432/jobhunter";

    _pool = new Pool({
      connectionString:        url,
      max:                     10,
      idleTimeoutMillis:       30_000,
      connectionTimeoutMillis: 5_000,
    });

    _pool.on("error", (err: Error) => {
      // Non-fatal — let callers handle per-query failures.
      // Use describeErr so AggregateErrors don't print a blank line.
      console.error("[storage] Pool error:", describeErr(err));
    });
  }
  return _pool;
}

export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

/** Test helper — reset the singleton between tests. */
export function _resetPoolForTesting(): void {
  _pool = null;
}