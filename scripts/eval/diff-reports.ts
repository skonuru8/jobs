/**
 * diff-reports.ts — Delta table between two eval JSON reports.
 *
 * Usage: npx tsx scripts/eval/diff-reports.ts old.json new.json
 *
 * Outputs per-fixture, per-check delta + summary row:
 * zero-op rate, mean coverage, banned-phrase total, compile failures, dropped-op total.
 */

import * as fs from "fs";
import * as path from "path";

interface EvalRow {
  slug: string;
  mode: string;
  status: "ok" | "error";
  compile_ok: boolean;
  word_count: number;
  word_count_in_bounds: boolean;
  patch_ops: number;
  patch_coverage_covered: number;
  patch_coverage_total: number;
  patch_ops_dropped_unknown_role: number;
  banned_phrase_count: number;
  forbid_violations: number;
  model: string;
  tokens_in: number;
  tokens_out: number;
  error?: string;
}

interface EvalReport {
  timestamp: string;
  canonical_sha: string;
  rows: EvalRow[];
}

function loadReport(filePath: string): EvalReport {
  const absPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  return JSON.parse(fs.readFileSync(absPath, "utf8"));
}

function key(row: EvalRow): string {
  return `${row.slug}::${row.mode}`;
}

function main() {
  const [, , oldPath, newPath] = process.argv;
  if (!oldPath || !newPath) {
    console.error("Usage: npx tsx scripts/eval/diff-reports.ts <old.json> <new.json>");
    process.exit(1);
  }

  const oldReport = loadReport(oldPath);
  const newReport = loadReport(newPath);

  const oldMap = new Map(oldReport.rows.map(r => [key(r), r]));
  const newMap = new Map(newReport.rows.map(r => [key(r), r]));

  const allKeys = new Set([...oldMap.keys(), ...newMap.keys()]);

  const lines: string[] = [
    `# Eval Delta Report`,
    ``,
    `**Old:** ${oldReport.timestamp} (sha: ${oldReport.canonical_sha})`,
    `**New:** ${newReport.timestamp} (sha: ${newReport.canonical_sha})`,
    ``,
    `## Per-fixture deltas`,
    ``,
    `| slug | mode | status | compile | ops Δ | coverage Δ | dropped Δ | banned Δ | forbid Δ | wc Δ |`,
    `|---|---|---|---|---|---|---|---|---|---|`,
  ];

  for (const k of allKeys) {
    const o = oldMap.get(k);
    const n = newMap.get(k);
    if (!o || !n) {
      lines.push(`| ${k.replace("::", " | ")} | ${o ? "removed" : "added"} | — | — | — | — | — | — | — |`);
      continue;
    }

    const opsOld = o.patch_coverage_total > 0 ? `${o.patch_coverage_covered}/${o.patch_coverage_total}` : "N/A";
    const opsNew = n.patch_coverage_total > 0 ? `${n.patch_coverage_covered}/${n.patch_coverage_total}` : "N/A";
    const covStr = `${opsOld}→${opsNew}`;

    const statusChange = o.status !== n.status ? `${o.status}→${n.status}` : n.status;
    const compileChange = o.compile_ok !== n.compile_ok ? `${o.compile_ok ? "✓" : "✗"}→${n.compile_ok ? "✓" : "✗"}` : (n.compile_ok ? "✓" : "✗");

    lines.push(
      `| ${n.slug.slice(0, 20)} | ${n.mode.replace("patch_tailoring", "P").replace("full_regen", "F")} | ${statusChange} | ${compileChange} | ${delta(o.patch_ops, n.patch_ops)} | ${covStr} | ${delta(o.patch_ops_dropped_unknown_role, n.patch_ops_dropped_unknown_role)} | ${delta(o.banned_phrase_count, n.banned_phrase_count)} | ${delta(o.forbid_violations, n.forbid_violations)} | ${delta(o.word_count, n.word_count)} |`
    );
  }

  // Summary
  const oldPatch = oldReport.rows.filter(r => r.mode === "patch_tailoring");
  const newPatch = newReport.rows.filter(r => r.mode === "patch_tailoring");

  const oldZeroOp = oldPatch.filter(r => r.patch_ops === 0).length;
  const newZeroOp = newPatch.filter(r => r.patch_ops === 0).length;

  const meanCov = (rows: EvalRow[]) => {
    const active = rows.filter(r => r.patch_coverage_total > 0);
    if (active.length === 0) return 0;
    return active.reduce((s, r) => s + r.patch_coverage_covered / r.patch_coverage_total, 0) / active.length;
  };

  const oldBanned = oldReport.rows.reduce((s, r) => s + r.banned_phrase_count, 0);
  const newBanned = newReport.rows.reduce((s, r) => s + r.banned_phrase_count, 0);
  const oldCompileFail = oldReport.rows.filter(r => !r.compile_ok).length;
  const newCompileFail = newReport.rows.filter(r => !r.compile_ok).length;
  const oldDropped = oldReport.rows.reduce((s, r) => s + r.patch_ops_dropped_unknown_role, 0);
  const newDropped = newReport.rows.reduce((s, r) => s + r.patch_ops_dropped_unknown_role, 0);

  lines.push("", "## Summary delta", "");
  lines.push(`| metric | old | new | Δ |`);
  lines.push(`|---|---|---|---|`);
  lines.push(`| zero-op rate (patch) | ${oldZeroOp}/${oldPatch.length} | ${newZeroOp}/${newPatch.length} | ${newZeroOp - oldZeroOp >= 0 ? "+" : ""}${newZeroOp - oldZeroOp} |`);
  lines.push(`| mean coverage (patch) | ${meanCov(oldPatch).toFixed(2)} | ${meanCov(newPatch).toFixed(2)} | ${(meanCov(newPatch) - meanCov(oldPatch) >= 0 ? "+" : "")}${(meanCov(newPatch) - meanCov(oldPatch)).toFixed(2)} |`);
  lines.push(`| banned phrase total | ${oldBanned} | ${newBanned} | ${delta(oldBanned, newBanned)} |`);
  lines.push(`| compile failures | ${oldCompileFail} | ${newCompileFail} | ${delta(oldCompileFail, newCompileFail)} |`);
  lines.push(`| dropped unknown-role ops | ${oldDropped} | ${newDropped} | ${delta(oldDropped, newDropped)} |`);

  const report = lines.join("\n") + "\n";
  console.log(report);

  // Also write to file
  const outPath = `output/audits/diff-${Date.now()}.md`;
  fs.mkdirSync("output/audits", { recursive: true });
  fs.writeFileSync(outPath, report, "utf8");
  console.error(`Written: ${outPath}`);
}

function delta(old: number, next: number): string {
  const d = next - old;
  if (d === 0) return "—";
  return `${d > 0 ? "+" : ""}${d}`;
}

main();
