/**
 * index.ts — public surface of the storage module.
 *
 * v4.1 additions:
 * - markStorageDisabled / isStorageAvailable — let run-pipeline.ts switch
 *   off persistence after a startup failure instead of retrying forever.
 * - formatErr — exported so other modules (run-pipeline, migrate.ts CLI)
 *   can format AggregateErrors consistently.
 * - _resetPoolForTesting / _resetDisabledForTesting — test helpers
 *   re-exported so the test file can reset module-level state between
 *   describe blocks. Prefixed with underscore by convention.
 */

export { getPool, closePool, _resetPoolForTesting } from "./db.js";

export { runMigrations } from "./migrate.js";

export {
  saveRun,
  finishRun,
  saveJob,
  isSeenInDB,
  markStorageDisabled,
  isStorageAvailable,
  formatErr,
  _resetDisabledForTesting,
} from "./persist.js";

export type { RunRecord, RunStats, JobRecord } from "./types.js";