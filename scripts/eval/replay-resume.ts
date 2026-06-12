/**
 * replay-resume.ts — Deterministic resume-generation replay for eval fixtures.
 *
 * For each fixture × mode in ["patch_tailoring", "full_regen"]:
 *   - Builds ResumeGenInput from fixture + current config/resume_master.tex
 *   - Calls the resume generator
 *   - Records checklist metrics (ops, coverage, banned phrases, word count, etc.)
 *
 * Emits:
 *   output/audits/eval-{timestamp}.md   — human-readable table
 *   output/audits/eval-{timestamp}.json — machine-readable for diff-reports.ts
 *
 * Gate: requires EVAL_LIVE=1 to make real LLM calls (costs money).
 *
 * Usage:
 *   EVAL_LIVE=1 npx tsx scripts/eval/replay-resume.ts [--mode patch_tailoring|full_regen]
 *   EVAL_LIVE=1 npx tsx scripts/eval/replay-resume.ts --fixture fixtures/eval/jobs/slug.json
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import { generateResumeTex } from "@/resume-generator/generator";
import { generatePatchedResumeTex } from "@/resume-generator/patch/orchestrator";
import { findBannedStylePhrases } from "@/shared/style-lint";
import type { ResumeGenConfig, ResumeGenInput } from "@/resume-generator/types";

const REPO_ROOT = path.resolve(__dirname, "../..");
const FIXTURES_DIR = path.join(REPO_ROOT, "fixtures", "eval", "jobs");
const AUDITS_DIR = path.join(REPO_ROOT, "output", "audits");
const CANONICAL_TEX_PATH = path.join(REPO_ROOT, "config", "resume_master.tex");
const CONFIG_PATH = path.join(REPO_ROOT, "config", "config.json");

const MODES: Array<"patch_tailoring" | "full_regen"> = ["patch_tailoring", "full_regen"];

// Rough cost estimate per fixture-mode pair (tokens × price)
const EST_TOKENS_PER_RUN = 4000;
const EST_COST_PER_1K = 0.002; // USD — rough estimate

async function main() {
  if (!process.env.EVAL_LIVE) {
    const fixtures = fs.existsSync(FIXTURES_DIR)
      ? fs.readdirSync(FIXTURES_DIR).filter(f => f.endsWith(".json")).length
      : 0;
    const estimatedRuns = fixtures * MODES.length;
    const estimatedTokens = estimatedRuns * EST_TOKENS_PER_RUN;
    const estimatedCost = (estimatedTokens / 1000) * EST_COST_PER_1K;
    console.error(`
EVAL_LIVE not set. This would make real LLM calls.
  Fixtures:       ${fixtures}
  Modes:          ${MODES.length} (${MODES.join(", ")})
  Est. runs:      ${estimatedRuns}
  Est. tokens:    ~${estimatedTokens.toLocaleString()}
  Est. cost:      ~$${estimatedCost.toFixed(3)}

Set EVAL_LIVE=1 to proceed.
`);
    process.exit(1);
  }

  // Load canonical resume
  if (!fs.existsSync(CANONICAL_TEX_PATH)) {
    console.error("canonical resume not found:", CANONICAL_TEX_PATH);
    process.exit(1);
  }
  const canonicalTex = fs.readFileSync(CANONICAL_TEX_PATH, "utf8");
  const canonicalSha = crypto.createHash("sha256").update(canonicalTex, "utf8").digest("hex").slice(0, 16);

  // Load config
  const rawConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const baseConfig: ResumeGenConfig = {
    model:                  rawConfig.llm.resume_generator.model,
    premium_model:          rawConfig.llm.resume_generator.premium_model,
    premium_min_score:      rawConfig.llm.resume_generator.premium_min_score ?? 0.70,
    max_tokens:             rawConfig.llm.resume_generator.max_tokens ?? 12000,
    temperature:            rawConfig.llm.resume_generator.temperature ?? 0.3,
    throttle_ms:            rawConfig.llm.resume_generator.throttle_ms ?? 1000,
    retries:                rawConfig.llm.resume_generator.retries ?? 1,
    compile_pdf:            rawConfig.llm.resume_generator.compile_pdf !== false,
    review_queue_threshold: rawConfig.llm.resume_generator.review_queue_threshold ?? 0.70,
    word_count_min:         rawConfig.llm.resume_generator.word_count_min ?? 1900,
    word_count_max:         rawConfig.llm.resume_generator.word_count_max ?? 2500,
  };

  // Collect fixtures
  const fixturePathArg = process.argv.find(a => a.startsWith("--fixture="))?.split("=")[1];
  const modeArg = process.argv.find(a => a.startsWith("--mode="))?.split("=")[1] as typeof MODES[0] | undefined;
  const modesToRun = modeArg ? [modeArg] : MODES;

  let fixturePaths: string[];
  if (fixturePathArg) {
    fixturePaths = [path.isAbsolute(fixturePathArg) ? fixturePathArg : path.join(REPO_ROOT, fixturePathArg)];
  } else {
    if (!fs.existsSync(FIXTURES_DIR)) {
      console.error(`Fixtures dir not found: ${FIXTURES_DIR}. Run export-fixtures.ts first.`);
      process.exit(1);
    }
    fixturePaths = fs.readdirSync(FIXTURES_DIR)
      .filter(f => f.endsWith(".json"))
      .map(f => path.join(FIXTURES_DIR, f));
  }

  if (fixturePaths.length === 0) {
    console.error("No fixtures found. Run: npx tsx scripts/eval/export-fixtures.ts");
    process.exit(1);
  }

  console.log(`Running ${fixturePaths.length} fixtures × ${modesToRun.length} modes = ${fixturePaths.length * modesToRun.length} runs`);

  const rows: EvalRow[] = [];

  for (const fixturePath of fixturePaths) {
    const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    const slug = fixture.slug ?? path.basename(fixturePath, ".json");

    for (const mode of modesToRun) {
      console.log(`  [${slug}] mode=${mode} ...`);
      const row = await runOne(fixture, mode, baseConfig, canonicalTex, canonicalSha);
      row.slug = slug;
      row.mode = mode;
      rows.push(row);
      console.log(`    status=${row.status} ops=${row.patch_ops} coverage=${row.patch_coverage_covered}/${row.patch_coverage_total} banned=${row.banned_phrase_count}`);
    }
  }

  // Write outputs
  fs.mkdirSync(AUDITS_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  const jsonPath = path.join(AUDITS_DIR, `eval-${timestamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({ timestamp, canonical_sha: canonicalSha, rows }, null, 2) + "\n", "utf8");

  const mdPath = path.join(AUDITS_DIR, `eval-${timestamp}.md`);
  fs.writeFileSync(mdPath, buildMarkdownReport(rows, timestamp, canonicalSha), "utf8");

  console.log(`\nReport: ${mdPath}`);
  console.log(`JSON:   ${jsonPath}`);

  // Summary
  const zeroOpRows = rows.filter(r => r.mode === "patch_tailoring" && (r.patch_ops ?? 0) === 0);
  const compileFails = rows.filter(r => !r.compile_ok);
  const bannedTotal = rows.reduce((s, r) => s + (r.banned_phrase_count ?? 0), 0);
  console.log(`\nSummary:`);
  console.log(`  zero-op rate (patch): ${zeroOpRows.length}/${rows.filter(r => r.mode === "patch_tailoring").length}`);
  console.log(`  compile failures:     ${compileFails.length}/${rows.length}`);
  console.log(`  banned phrase total:  ${bannedTotal}`);
}

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
  // LLM-variant fields (non-deterministic)
  _llm_variant: true;
}

async function runOne(
  fixture: any,
  mode: "patch_tailoring" | "full_regen",
  baseConfig: ResumeGenConfig,
  canonicalTex: string,
  canonicalSha: string,
): Promise<EvalRow> {
  const config: ResumeGenConfig = { ...baseConfig, mode };

  // Build a minimal ArtifactJudgeJson-compatible judge_json
  const judgeJson = fixture.judge_json ?? {};
  const gapDirectives = judgeJson.gap_directives ?? [];
  const tailoringHints = judgeJson.tailoring_hints ?? {};

  const input: ResumeGenInput = {
    job: fixture.job,
    profile: {} as any,  // not used in generation path
    canonical_resume_tex: canonicalTex,
    jd_json: fixture.jd_json ?? {},
    judge_json: {
      verdict:         judgeJson.verdict ?? null,
      reasoning:       judgeJson.reasoning ?? null,
      concerns:        judgeJson.concerns ?? [],
      confidence:      judgeJson.confidence ?? null,
      key_matches:     judgeJson.key_matches ?? [],
      gaps:            judgeJson.gaps ?? [],
      gap_directives:  gapDirectives,
      why_apply:       judgeJson.why_apply ?? null,
      tailoring_hints: tailoringHints,
    },
    score: {
      total:      fixture.score.total,
      components: fixture.score.components,
    },
    canonical_sha: canonicalSha,
    gap_directives: gapDirectives,
    tech_swaps:     tailoringHints.tech_swaps ?? [],
  };

  let gen;
  try {
    gen = mode === "patch_tailoring"
      ? await generatePatchedResumeTex(input, config)
      : await generateResumeTex(input, config);
  } catch (e: any) {
    return {
      slug: "", mode,
      status: "error",
      compile_ok: false,
      word_count: 0, word_count_in_bounds: false,
      patch_ops: 0, patch_coverage_covered: 0, patch_coverage_total: 0,
      patch_ops_dropped_unknown_role: 0,
      banned_phrase_count: 0, forbid_violations: 0,
      model: "", tokens_in: 0, tokens_out: 0,
      error: String(e).slice(0, 300),
      _llm_variant: true,
    };
  }

  const wMin = baseConfig.word_count_min ?? 1900;
  const wMax = baseConfig.word_count_max ?? 2500;

  const bannedPhrases = gen.tex ? findBannedStylePhrases(gen.tex) : [];

  // Forbid violations: check inserted/rewritten text against forbid directives
  const forbidTerms = gapDirectives
    .filter((d: any) => d.handling === "forbid" && d.jd_requirement)
    .map((d: any) => d.jd_requirement.trim());
  let forbidViolations = 0;
  if (gen.patch?.ops && forbidTerms.length > 0) {
    for (const op of gen.patch.ops) {
      const text = (op as any).new_item ?? (op as any).item ?? "";
      for (const term of forbidTerms) {
        const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        if (re.test(text)) forbidViolations++;
      }
    }
  }

  return {
    slug: "", mode,
    status: gen.status,
    compile_ok: gen.status === "ok",
    word_count: gen.word_count,
    word_count_in_bounds: gen.word_count >= wMin && gen.word_count <= wMax,
    patch_ops: gen.patch?.ops?.length ?? 0,
    patch_coverage_covered: gen.patch?.coverage?.covered ?? 0,
    patch_coverage_total: gen.patch?.coverage?.total ?? 0,
    patch_ops_dropped_unknown_role: gen.patch?.ops_dropped_unknown_role ?? 0,
    banned_phrase_count: bannedPhrases.length,
    forbid_violations: forbidViolations,
    model: gen.model,
    tokens_in: gen.tokens.input,
    tokens_out: gen.tokens.output,
    error: gen.error,
    _llm_variant: true,
  };
}

function buildMarkdownReport(rows: EvalRow[], timestamp: string, canonicalSha: string): string {
  const lines = [
    `# Resume Eval Report — ${timestamp}`,
    ``,
    `canonical_sha: \`${canonicalSha}\``,
    ``,
    `| slug | mode | status | compile | wc | wc_ok | ops | cov | dropped | banned | forbid | model | tok_in | tok_out |`,
    `|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`,
  ];
  for (const r of rows) {
    const cov = r.patch_coverage_total > 0
      ? `${r.patch_coverage_covered}/${r.patch_coverage_total}`
      : "N/A";
    lines.push(
      `| ${r.slug.slice(0, 20)} | ${r.mode.replace("_tailoring", "").replace("patch", "P").replace("full_regen", "F")} | ${r.status} | ${r.compile_ok ? "✓" : "✗"} | ${r.word_count} | ${r.word_count_in_bounds ? "✓" : "✗"} | ${r.patch_ops} | ${cov} | ${r.patch_ops_dropped_unknown_role} | ${r.banned_phrase_count} | ${r.forbid_violations} | ${r.model.split("/").pop()?.slice(0, 15) ?? ""} | ${r.tokens_in} | ${r.tokens_out} |`
    );
  }

  // Summary
  const patchRows = rows.filter(r => r.mode === "patch_tailoring");
  const zeroOpRate = patchRows.length > 0
    ? `${patchRows.filter(r => r.patch_ops === 0).length}/${patchRows.length}`
    : "N/A";
  const meanCoverage = patchRows.length > 0
    ? (patchRows.filter(r => r.patch_coverage_total > 0)
        .reduce((s, r) => s + r.patch_coverage_covered / r.patch_coverage_total, 0)
      / Math.max(1, patchRows.filter(r => r.patch_coverage_total > 0).length)).toFixed(2)
    : "N/A";
  const bannedTotal = rows.reduce((s, r) => s + r.banned_phrase_count, 0);
  const compileFails = rows.filter(r => !r.compile_ok).length;
  const droppedTotal = rows.reduce((s, r) => s + r.patch_ops_dropped_unknown_role, 0);

  lines.push("", "## Summary", "");
  lines.push(`| metric | value |`);
  lines.push(`|---|---|`);
  lines.push(`| zero-op rate (patch) | ${zeroOpRate} |`);
  lines.push(`| mean coverage (patch) | ${meanCoverage} |`);
  lines.push(`| banned phrase total | ${bannedTotal} |`);
  lines.push(`| compile failures | ${compileFails}/${rows.length} |`);
  lines.push(`| dropped unknown-role ops total | ${droppedTotal} |`);

  return lines.join("\n") + "\n";
}

main().catch(e => { console.error(e); process.exit(1); });
