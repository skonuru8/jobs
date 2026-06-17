/**
 * batch-evals.ts — CLI to generate an evals-summary.json for a batch directory.
 *
 * Usage:
 *   npx tsx scripts/eval/batch-evals.ts [batch-dir]
 *
 * If batch-dir is omitted, targets today's output directory.
 * Reads evals from each job's meta.json and writes evals-summary.json to the batch root.
 * Also appends a trend row to output/evals-history.jsonl.
 *
 * Example:
 *   npx tsx scripts/eval/batch-evals.ts output/applications/2026-06-16
 */

import * as path from "path";
import * as fs   from "fs";
import { fileURLToPath } from "url";
import { writeBatchReport } from "@/evals/batch-report";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const repoRoot   = path.resolve(__dirname, "../..");
const today    = new Date().toISOString().slice(0, 10);

const arg = process.argv[2];
const batchDir = arg
  ? path.resolve(repoRoot, arg)
  : path.join(repoRoot, "output", "applications", today);

if (!fs.existsSync(batchDir)) {
  console.error(`[batch-evals] directory not found: ${batchDir}`);
  process.exit(1);
}

console.log(`[batch-evals] scanning: ${batchDir}`);
const summaryPath = writeBatchReport(batchDir, repoRoot);
console.log(`[batch-evals] done: ${summaryPath}`);
