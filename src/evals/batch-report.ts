/**
 * batch-report.ts — Aggregates per-job eval results into a batch summary.
 *
 * Reads all meta.json files in a batch output directory, aggregates evals,
 * and writes evals-summary.json to the batch root. Also appends a row to
 * evals-history.jsonl for trend tracking across batches.
 *
 * Called by: scripts or CLI after a generation batch completes
 * Writes to: <batchDir>/evals-summary.json, <repoRoot>/output/evals-history.jsonl
 * Side effects: file writes only
 */

import * as fs from "fs";
import * as path from "path";

import type { BatchJobRow, BatchSummary, EvalResult, OverallQuality } from "./types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Aggregates all meta.json evals under batchDir into a single summary file.
 *
 * @param batchDir - Root of the batch output directory (contains job subdirs).
 * @param repoRoot - Repository root for writing the history jsonl file.
 * @returns Path to written evals-summary.json.
 */
export function writeBatchReport(batchDir: string, repoRoot: string): string {
  const metaFiles = findMetaFiles(batchDir);
  const rows: BatchJobRow[] = [];
  const degradedByPatchSha: Record<string, number> = {};
  let missingEvals = 0;

  for (const metaFile of metaFiles) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
      const evals: EvalResult | undefined = meta.evals;
      if (!evals) {
        missingEvals++;
        rows.push({
          job_id: meta.job_id ?? "unknown",
          company: meta.job_meta?.company ?? "",
          title: meta.job_meta?.title ?? "",
          resume_quality: "skipped",
          cover_quality: "skipped",
          degraded_emphasis_ops: 0,
          dropped_phrases: [],
          flags: ["evals_missing"],
        });
        continue;
      }

      const degradedEmphOps = (evals.resume?.emphasis_ops ?? []).filter(
        e => e.scores.net_quality === "degraded",
      );
      const droppedPhrases = degradedEmphOps.flatMap(e => e.dropped_phrases);

      const row: BatchJobRow = {
        job_id: meta.job_id ?? "unknown",
        company: meta.job_meta?.company ?? "",
        title: meta.job_meta?.title ?? "",
        resume_quality: (evals.resume?.overall_quality ?? "skipped") as OverallQuality | "skipped",
        cover_quality: (evals.cover_letter?.overall_quality ?? "skipped") as OverallQuality | "skipped",
        degraded_emphasis_ops: degradedEmphOps.length,
        dropped_phrases: droppedPhrases,
        flags: [...(evals.resume?.flags ?? [])],
      };
      rows.push(row);

      if (degradedEmphOps.length > 0 && evals.patch_prompt_sha) {
        degradedByPatchSha[evals.patch_prompt_sha] =
          (degradedByPatchSha[evals.patch_prompt_sha] ?? 0) + degradedEmphOps.length;
      }
    } catch {
      // skip unreadable or non-eval meta files
    }
  }

  const batchId = path.basename(batchDir);
  const total = rows.length;
  const fail  = rows.filter(r => r.resume_quality === "fail" || r.cover_quality === "fail").length;
  const warn  = rows.filter(r =>
    (r.resume_quality === "warning" || r.cover_quality === "warning") &&
    r.resume_quality !== "fail" && r.cover_quality !== "fail",
  ).length;
  const pass = total - fail - warn - missingEvals;

  const summary: BatchSummary = {
    batch_id: batchId,
    run_at: new Date().toISOString(),
    total,
    missing_evals: missingEvals,
    pass,
    warn,
    fail,
    degraded_by_patch_prompt_sha: degradedByPatchSha,
    jobs: rows,
  };

  const summaryPath = path.join(batchDir, "evals-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");
  console.log(`[evals] batch report written: ${summaryPath} (${total} jobs, ${fail} fail, ${warn} warn, ${pass} pass)`);

  appendTrendRow(repoRoot, batchId, summary);

  return summaryPath;
}

// ---------------------------------------------------------------------------
// Trend history
// ---------------------------------------------------------------------------

function appendTrendRow(repoRoot: string, batchId: string, summary: BatchSummary): void {
  const histPath = path.join(repoRoot, "output", "evals-history.jsonl");
  const degradedTotal = Object.values(summary.degraded_by_patch_prompt_sha).reduce((a, b) => a + b, 0);
  const degradedRate = summary.total > 0 ? degradedTotal / summary.total : 0;
  const failRate     = summary.total > 0 ? summary.fail  / summary.total : 0;

  const patchShas = Object.keys(summary.degraded_by_patch_prompt_sha);
  const row = {
    batch_id:         batchId,
    run_at:           summary.run_at,
    total:            summary.total,
    pass:             summary.pass,
    warn:             summary.warn,
    fail:             summary.fail,
    degraded_rate:    degradedRate,
    fail_rate:        failRate,
    patch_prompt_shas: patchShas,
    degraded_by_patch_prompt_sha: summary.degraded_by_patch_prompt_sha,
  };

  fs.mkdirSync(path.dirname(histPath), { recursive: true });
  fs.appendFileSync(histPath, JSON.stringify(row) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findMetaFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findMetaFiles(full));
    } else if (entry.name === "meta.json") {
      results.push(full);
    }
  }
  return results;
}
