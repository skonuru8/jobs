/**
 * backfill-evals.ts — Retroactively compute and write evals for existing meta.json files.
 *
 * Reads all meta.json files in a batch directory (or today's), runs the deterministic
 * eval runner against each job's patch_ops + canonical resume, and writes the evals
 * key back into meta.json. Then runs writeBatchReport to produce evals-summary.json.
 *
 * Usage:
 *   npx tsx scripts/eval/backfill-evals.ts [batch-dir]
 *
 * Example:
 *   npx tsx scripts/eval/backfill-evals.ts output/applications/2026-06-16
 */

import * as path from "path";
import * as fs   from "fs";
import { fileURLToPath } from "url";

import { runEvals } from "@/evals/runner";
import { writeBatchReport } from "@/evals/batch-report";
import { stripLatex } from "@/cover-letter/resume";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const repoRoot   = path.resolve(__dirname, "../..");
const today      = new Date().toISOString().slice(0, 10);

const arg = process.argv[2];
const batchDir = arg
  ? path.resolve(repoRoot, arg)
  : path.join(repoRoot, "output", "applications", today);

if (!fs.existsSync(batchDir)) {
  console.error(`[backfill-evals] directory not found: ${batchDir}`);
  process.exit(1);
}

const canonicalTex = fs.readFileSync(
  path.join(repoRoot, "config", "resume_master.tex"),
  "utf8",
);

const metaFiles = findMetaFiles(batchDir);
console.log(`[backfill-evals] found ${metaFiles.length} meta.json files`);

let updated = 0;
for (const metaFile of metaFiles) {
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    // always recompute (overwrite any existing evals with latest runner logic)

    const judgeJson = {
      tailoring_hints: meta.judge?.tailoring_hints ?? {},
      gap_directives:  meta.judge?.gap_directives ?? [],
    };
    const patchOps   = meta.resume?.patch_ops ?? [];
    const resumeFlags = meta.resume?.flags ?? [];
    const patchPromptSha = meta.resume?.patch_prompt_sha ?? null;
    const coverFlags  = meta.cover_letter?.flags ?? [];
    const coverWc     = meta.cover_letter?.word_count ?? 0;
    const coverSha    = meta.cover_letter?.prompt_sha ?? null;
    const coverLetterText = readCoverLetterText(meta);

    const evals = runEvals({
      canonicalTex,
      judgeJson,
      patchOps,
      resumeFlags,
      patchPromptSha,
      coverLetterText,
      coverFlags,
      coverWordCount:  coverWc,
      coverPromptSha:  coverSha,
    });

    meta.evals = evals;
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), "utf8");
    updated++;
  } catch (e) {
    console.warn(`[backfill-evals] skipped ${metaFile}: ${e}`);
  }
}

console.log(`[backfill-evals] updated ${updated} meta.json files`);

const summaryPath = writeBatchReport(batchDir, repoRoot);
console.log(`[backfill-evals] summary: ${summaryPath}`);

function findMetaFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findMetaFiles(full));
    else if (entry.name === "meta.json") results.push(full);
  }
  return results;
}

function readCoverLetterText(meta: Record<string, any>): string | undefined {
  const texPath = meta.cover_letter?.tex_path;
  if (typeof texPath !== "string" || !texPath.trim()) return undefined;

  const texAbs = path.isAbsolute(texPath)
    ? texPath
    : path.resolve(repoRoot, texPath);
  if (!fs.existsSync(texAbs)) return undefined;

  return stripLatex(fs.readFileSync(texAbs, "utf8")).trim();
}
