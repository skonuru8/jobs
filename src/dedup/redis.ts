/**
 * redis.ts — cross-run exact dedup via Redis SET.
 *
 * Key schema:  seen:{source}:{job_id}
 * Value:       "1"
 * TTL:         7 days (configurable)
 *
 * isSeen()   — checks whether we've already processed this job_id this week.
 * markSeen() — records the job_id after processing.
 *
 * Both functions are non-throwing. On Redis connection failure they return
 * a safe fallback (false / no-op) so the pipeline can continue without dedup.
 */

import Redis from "ioredis";

const DEFAULT_TTL_DAYS = 7;

let _client: Redis | null = null;
let _connectionFailed     = false;

function getClient(): Redis | null {
  if (_connectionFailed) return null;
  if (_client) return _client;

  const url = process.env.REDIS_URL ?? "redis://localhost:6379";

  _client = new Redis(url, {
    lazyConnect:           true,
    enableOfflineQueue:    false,
    maxRetriesPerRequest:  1,
    connectTimeout:        3_000,
    commandTimeout:        2_000,
  });

  _client.on("error", (err: Error) => {
    if (!_connectionFailed) {
      console.warn(`[dedup/redis] Connection error: ${err.message}. Dedup will be skipped.`);
      _connectionFailed = true;
    }
  });

  return _client;
}

/** Connect eagerly. Call once at pipeline start. Errors are non-fatal. */
export async function connectRedis(): Promise<void> {
  const client = getClient();
  if (!client) return;
  try {
    await client.connect();
    await client.ping();
    console.log("[dedup/redis] Connected.");
  } catch (e: any) {
    console.warn(`[dedup/redis] Could not connect: ${e.message}. Exact dedup disabled.`);
    _connectionFailed = true;
  }
}

/** Disconnect. Call at pipeline end. */
export async function disconnectRedis(): Promise<void> {
  if (_client) {
    await _client.quit().catch(() => {});
    _client = null;
  }
}

function key(source: string, jobId: string): string {
  return `seen:${source}:${jobId}`;
}

/**
 * Returns true if this job has been processed in a previous run this week.
 * Returns false on any Redis error (treat as unseen — safe direction).
 */
export async function isSeen(source: string, jobId: string): Promise<boolean> {
  const client = getClient();
  if (!client || _connectionFailed) return false;
  try {
    const result = await client.exists(key(source, jobId));
    return result === 1;
  } catch {
    return false;
  }
}

/**
 * Marks this job as seen. Call after full processing so a crashed run
 * doesn't prevent re-processing on retry.
 *
 * ttlDays: how long to remember the job (default 7 days).
 */
export async function markSeen(
  source:  string,
  jobId:   string,
  ttlDays: number = DEFAULT_TTL_DAYS,
): Promise<void> {
  const client = getClient();
  if (!client || _connectionFailed) return;
  try {
    await client.set(key(source, jobId), "1", "EX", ttlDays * 86_400);
  } catch {
    // non-fatal
  }
}

/**
 * List seen job IDs for a source via SCAN.
 * Returns [] on any Redis error.
 */
export async function listSeenJobIds(source: string): Promise<string[]> {
  const client = getClient();
  if (!client || _connectionFailed) return [];
  const out: string[] = [];
  const prefix = `seen:${source}:`;
  try {
    let cursor = "0";
    do {
      const [nextCursor, keys] = await client.scan(
        cursor,
        "MATCH",
        `${prefix}*`,
        "COUNT",
        1000,
      );
      cursor = nextCursor;
      for (const k of keys) {
        if (k.startsWith(prefix)) out.push(k.slice(prefix.length));
      }
    } while (cursor !== "0");
  } catch {
    return [];
  }
  return out;
}
