/**
 * trigger-once.ts — run a single orchestrator tick immediately.
 *
 * Useful for smoke testing without waiting for cron.
 *
 * Usage (from repo root):
 *   npx tsx src/orchestrator/trigger-once.ts
 */

import { randomUUID } from "crypto";
import { spawnRun } from "./runner.js";

async function main(): Promise<void> {
  const runId = `manual-${randomUUID()}`;

  await spawnRun({
    source:       process.env.SOURCE ?? "dice",
    postedWithin: process.env.POSTED_WITHIN ?? "ONE",
    max:          parseInt(process.env.MAX ?? "10", 10),
    runId,
    lockTtlSecs:  14_400,
  });
}

main().catch((e) => {
  console.error("[trigger-once] fatal:", (e as Error).message);
  process.exit(1);
});

