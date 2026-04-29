/**
 * migrate.ts — run all SQL migrations in order.
 *
 * Migrations are idempotent (CREATE TABLE IF NOT EXISTS etc.) — safe to re-run.
 *
 * Usage:
 *   npx tsx storage/src/migrate.ts
 *   # or via package.json: cd storage && npm run migrate
 *
 * --------------------------------------------------------------------------
 * v4.1 changes:
 * - Uses formatErr() so the thrown Error has a meaningful message even when
 *   pg throws AggregateError. Previously the wrapped error was
 *   "Migration failed (001_initial.sql): " with nothing after the colon
 *   because AggregateError.message is empty by default.
 * - Standalone CLI invocation (when run directly) prints a prominent
 *   troubleshooting hint when the failure looks like a connection issue.
 *   Helps the next person to set this up not waste an hour figuring out
 *   they forgot to start Postgres.
 */

import * as fs   from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import { getPool, closePool } from "./db.js";
import { formatErr }          from "./persist.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const REPO_ROOT  = path.resolve(__dirname, "../..");
const MIGS_DIR   = path.join(REPO_ROOT, "migrations");

export async function runMigrations(): Promise<void> {
  const pool  = getPool();
  const files = fs.readdirSync(MIGS_DIR)
    .filter(f => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGS_DIR, file), "utf-8");
    try {
      await pool.query(sql);
      console.log(`[storage] ✓ ${file}`);
    } catch (e) {
      // formatErr unwraps AggregateError so the rethrown message has detail.
      throw new Error(`Migration failed (${file}): ${formatErr(e)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// CLI entry point — only runs when invoked directly via `npx tsx`,
// not when imported by run-pipeline.ts.
// ---------------------------------------------------------------------------

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runMigrations()
    .then(() => {
      console.log("[storage] Migrations complete.");
      return closePool();
    })
    .catch(err => {
      const msg = formatErr(err);
      console.error("[storage] Migration error:", msg);

      // If this looks like a connection failure, give a hint.
      if (/ECONNREFUSED|connect|EAI_AGAIN|ENOTFOUND/i.test(msg)) {
        console.error("");
        console.error("[storage] Hint: Postgres doesn't appear to be running.");
        console.error("[storage]   Default DATABASE_URL: postgresql://postgres:postgres@localhost:5432/jobhunter");
        console.error("[storage]   Start the local services: docker compose up -d");
      }

      process.exit(1);
    });
}