/**
 * compare-models.ts — Compare Pro vs Flash model patch generation for multiple jobs.
 *
 * Runs generatePatchOps twice per job (once with deepseek-v4-pro, once with
 * deepseek-v4-flash), applies ops via applyPatchOps, runs deterministic evals,
 * and writes a comparison JSON to output/audits/compare-models-{timestamp}.json.
 *
 * Usage:
 *   npx tsx scripts/eval/compare-models.ts [--limit N] [--jobs job_id1,job_id2,...]
 *
 * Default limit: 30. If --jobs is specified, only those job IDs are processed.
 */

import { fileURLToPath } from "url";
import * as path from "path";
import * as fs from "fs";

import { config as loadEnv } from "dotenv";
import { generatePatchOps } from "@/resume-generator/patch/generator";
import { applyPatchOps } from "@/resume-generator/patch/apply";
import { extractRoleBlocks } from "@/resume-generator/patch/parser";
import { runEvals, type EvalInput } from "@/evals/runner";
import type { ResumeGenConfig, ResumeGenInput } from "@/resume-generator/types";
import type { PatchOp } from "@/resume-generator/patch/types";
import type { EvalResult } from "@/evals/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let limit = 30;
let filterJobIds: string[] | null = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--limit" && args[i + 1]) {
    limit = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === "--jobs" && args[i + 1]) {
    filterJobIds = args[i + 1].split(",").map(s => s.trim()).filter(Boolean);
    i++;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MetaJson {
  job_id: string;
  job_meta?: {
    company?: string;
    title?: string;
  };
  score: number;
  judge: {
    verdict: string;
    gap_directives?: unknown[];
    tailoring_hints?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface ModelResult {
  model: string;
  ops_count: number;
  input_tokens: number;
  output_tokens: number;
  resume_quality: string;
  info_loss_ops: number;
  dropped_phrases: string[];
  tech_forward_gain: number;
  error?: string;
}

interface JobComparison {
  job_id: string;
  company: string;
  score: number;
  verdict: string;
  directive_count: number;
  emphasis_role_count: number;
  pro: ModelResult;
  flash: ModelResult;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runForModel(
  modelOverride: string,
  input: ResumeGenInput,
  config: ResumeGenConfig,
  canonicalTex: string,
): Promise<ModelResult> {
  const roleBlocks = extractRoleBlocks(canonicalTex);
  let ops: PatchOp[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const result = await generatePatchOps(input, config, roleBlocks, undefined, modelOverride);
    ops = result.ops;
    inputTokens = result.tokens.input;
    outputTokens = result.tokens.output;
  } catch (e: unknown) {
    const errMsg = String(e);
    return {
      model: modelOverride,
      ops_count: 0,
      input_tokens: 0,
      output_tokens: 0,
      resume_quality: "fail",
      info_loss_ops: 0,
      dropped_phrases: [],
      tech_forward_gain: 0,
      error: errMsg.slice(0, 500),
    };
  }

  const patchedTex = applyPatchOps(canonicalTex, ops);

  const evalInput: EvalInput = {
    canonicalTex,
    judgeJson: {
      tailoring_hints: input.judge_json.tailoring_hints as EvalInput["judgeJson"]["tailoring_hints"],
      gap_directives: (input.judge_json.gap_directives ?? []) as EvalInput["judgeJson"]["gap_directives"],
    },
    patchOps: ops as EvalInput["patchOps"],
    resumeFlags: [],
  };

  const evalResult: EvalResult = runEvals(evalInput);
  const resumeEval = evalResult.resume;

  const infoLossOps = resumeEval?.emphasis_ops.filter(e => e.scores.info_loss).length ?? 0;
  const droppedPhrases = resumeEval?.emphasis_ops.flatMap(e => e.dropped_phrases) ?? [];
  const avgTechGain =
    (resumeEval?.emphasis_ops.length ?? 0) > 0
      ? (resumeEval!.emphasis_ops.reduce((sum, e) => sum + e.scores.tech_forward_gain, 0) /
          resumeEval!.emphasis_ops.length)
      : 0;

  // patchedTex is used to confirm the ops applied; we don't persist it here
  void patchedTex;

  return {
    model: modelOverride,
    ops_count: ops.length,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    resume_quality: resumeEval?.overall_quality ?? "ok",
    info_loss_ops: infoLossOps,
    dropped_phrases: droppedPhrases,
    tech_forward_gain: Math.round(avgTechGain * 1000) / 1000,
    error: undefined,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  loadEnv({ path: path.join(repoRoot, ".env") });

  const canonicalTexPath = path.join(repoRoot, "config", "resume_master.tex");
  if (!fs.existsSync(canonicalTexPath)) {
    console.error(`[compare-models] canonical TeX not found: ${canonicalTexPath}`);
    process.exit(1);
  }
  const canonicalTex = fs.readFileSync(canonicalTexPath, "utf8");

  const configPath = path.join(repoRoot, "config", "config.json");
  const rawConfig = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    llm: {
      resume_generator: {
        max_tokens?: number;
        patch_max_tokens?: number;
        temperature?: number;
      };
    };
  };

  const resumeConfig: ResumeGenConfig = {
    model: "deepseek/deepseek-v4-flash",
    max_tokens: rawConfig.llm.resume_generator.max_tokens ?? 12000,
    patch_max_tokens: rawConfig.llm.resume_generator.patch_max_tokens ?? 12000,
    temperature: rawConfig.llm.resume_generator.temperature ?? 0.3,
    throttle_ms: 0,
    compile_pdf: false,
    review_queue_threshold: 0,
    retries: 0,
  };

  // Find all meta.json files with valid judge block and score
  const appRoot = path.join(repoRoot, "output", "applications");
  // Directory structure: output/applications/{date}/{run_dir}/{job_slug}/meta.json
  const allMetaPaths: string[] = [];
  for (const dateDirent of fs.readdirSync(appRoot, { withFileTypes: true })) {
    if (!dateDirent.isDirectory()) continue;
    const dateDir = path.join(appRoot, dateDirent.name);
    for (const runDirent of fs.readdirSync(dateDir, { withFileTypes: true })) {
      if (!runDirent.isDirectory()) continue;
      const runDir = path.join(dateDir, runDirent.name);
      for (const jobDirent of fs.readdirSync(runDir, { withFileTypes: true })) {
        if (!jobDirent.isDirectory()) continue;
        const candidate = path.join(runDir, jobDirent.name, "meta.json");
        if (fs.existsSync(candidate)) {
          allMetaPaths.push(candidate);
        }
      }
    }
  }

  // Parse and filter
  const validMetas: Array<{ path: string; meta: MetaJson }> = [];
  for (const metaPath of allMetaPaths) {
    try {
      const m = JSON.parse(fs.readFileSync(metaPath, "utf8")) as MetaJson;
      if (
        m.job_id &&
        typeof m.score === "number" &&
        m.judge &&
        m.judge.verdict
      ) {
        if (filterJobIds === null || filterJobIds.includes(m.job_id)) {
          validMetas.push({ path: metaPath, meta: m });
        }
      }
    } catch {
      // skip malformed
    }
  }

  const selected = validMetas.slice(0, limit);
  console.log(
    `[compare-models] found ${validMetas.length} valid jobs, running ${selected.length} (limit=${limit})`,
  );

  const results: JobComparison[] = [];

  for (let i = 0; i < selected.length; i++) {
    const { meta: m } = selected[i];
    const jobLabel = `[${i + 1}/${selected.length}] ${m.job_id.slice(0, 8)} (${m.job_meta?.company ?? "?"})`;
    console.log(`\n${jobLabel} score=${m.score} verdict=${m.judge.verdict}`);

    const input = {
      canonical_resume_tex: canonicalTex,
      judge_json: {
        verdict: m.judge.verdict,
        gap_directives: (m.judge.gap_directives ?? []) as ResumeGenInput["judge_json"]["gap_directives"],
        tailoring_hints: m.judge.tailoring_hints as ResumeGenInput["judge_json"]["tailoring_hints"],
        reasoning: null,
        concerns: [],
      },
      score: {
        total: m.score,
        components: {} as ResumeGenInput["score"]["components"],
      },
      gap_directives: (m.judge.gap_directives ?? []) as ResumeGenInput["gap_directives"],
      jd_json: {} as ResumeGenInput["jd_json"],
      job: {} as ResumeGenInput["job"],
      profile: {} as ResumeGenInput["profile"],
      canonical_sha: m.canonical_sha as string ?? "",
    } as ResumeGenInput;

    const directiveCount = (m.judge.gap_directives ?? []).length;
    const emphasisRoles =
      (m.judge.tailoring_hints as { emphasize_roles?: string[] } | undefined)
        ?.emphasize_roles?.length ?? 0;

    // Run Pro
    console.log(`  -> pro model...`);
    let proResult = await runForModel("deepseek/deepseek-v4-pro", input, resumeConfig, canonicalTex);
    if (proResult.error?.includes("429")) {
      console.log(`  [rate-limit] 429 on pro, sleeping 5s...`);
      await sleep(5000);
      proResult = await runForModel("deepseek/deepseek-v4-pro", input, resumeConfig, canonicalTex);
    }
    console.log(
      `     ops=${proResult.ops_count} quality=${proResult.resume_quality} tokens=${proResult.input_tokens}/${proResult.output_tokens}${proResult.error ? " err=" + proResult.error.slice(0, 60) : ""}`,
    );

    // Run Flash
    console.log(`  -> flash model...`);
    let flashResult = await runForModel(
      "deepseek/deepseek-v4-flash",
      input,
      resumeConfig,
      canonicalTex,
    );
    if (flashResult.error?.includes("429")) {
      console.log(`  [rate-limit] 429 on flash, sleeping 5s...`);
      await sleep(5000);
      flashResult = await runForModel(
        "deepseek/deepseek-v4-flash",
        input,
        resumeConfig,
        canonicalTex,
      );
    }
    console.log(
      `     ops=${flashResult.ops_count} quality=${flashResult.resume_quality} tokens=${flashResult.input_tokens}/${flashResult.output_tokens}${flashResult.error ? " err=" + flashResult.error.slice(0, 60) : ""}`,
    );

    results.push({
      job_id: m.job_id,
      company: m.job_meta?.company ?? "",
      score: m.score,
      verdict: m.judge.verdict,
      directive_count: directiveCount,
      emphasis_role_count: emphasisRoles,
      pro: proResult,
      flash: flashResult,
    });
  }

  // Write output JSON
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const auditDir = path.join(repoRoot, "output", "audits");
  if (!fs.existsSync(auditDir)) {
    fs.mkdirSync(auditDir, { recursive: true });
  }
  const outPath = path.join(auditDir, `compare-models-${timestamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ generated_at: new Date().toISOString(), limit, total_jobs: results.length, results }, null, 2));
  console.log(`\n[compare-models] wrote: ${outPath}`);

  // Summary table
  const count = results.length;
  const pct = (n: number) => count > 0 ? `${((n / count) * 100).toFixed(0)}%` : "n/a";

  const proOk = results.filter(r => r.pro.resume_quality === "ok").length;
  const proWarn = results.filter(r => r.pro.resume_quality === "warning").length;
  const proFail = results.filter(r => r.pro.resume_quality === "fail").length;
  const proInfoLoss = results.reduce((s, r) => s + r.pro.info_loss_ops, 0);
  const proAvgIn = count > 0 ? Math.round(results.reduce((s, r) => s + r.pro.input_tokens, 0) / count) : 0;
  const proAvgOut = count > 0 ? Math.round(results.reduce((s, r) => s + r.pro.output_tokens, 0) / count) : 0;
  const proErrors = results.filter(r => r.pro.error).length;

  const flOk = results.filter(r => r.flash.resume_quality === "ok").length;
  const flWarn = results.filter(r => r.flash.resume_quality === "warning").length;
  const flFail = results.filter(r => r.flash.resume_quality === "fail").length;
  const flInfoLoss = results.reduce((s, r) => s + r.flash.info_loss_ops, 0);
  const flAvgIn = count > 0 ? Math.round(results.reduce((s, r) => s + r.flash.input_tokens, 0) / count) : 0;
  const flAvgOut = count > 0 ? Math.round(results.reduce((s, r) => s + r.flash.output_tokens, 0) / count) : 0;
  const flErrors = results.filter(r => r.flash.error).length;

  const col = (s: string) => String(s).padEnd(12);

  console.log(`\nMODEL COMPARISON SUMMARY (${count} jobs)`);
  console.log(`                     ${col("PRO")}${col("FLASH")}`);
  console.log(`ok                   ${col(`${proOk} (${pct(proOk)})`)}${col(`${flOk} (${pct(flOk)})`)} `);
  console.log(`warning              ${col(`${proWarn} (${pct(proWarn)})`)}${col(`${flWarn} (${pct(flWarn)})`)} `);
  console.log(`fail                 ${col(`${proFail} (${pct(proFail)})`)}${col(`${flFail} (${pct(flFail)})`)} `);
  console.log(`info_loss_ops        ${col(String(proInfoLoss))}${col(String(flInfoLoss))} `);
  console.log(`avg_input_tokens     ${col(String(proAvgIn))}${col(String(flAvgIn))} `);
  console.log(`avg_output_tokens    ${col(String(proAvgOut))}${col(String(flAvgOut))} `);
  console.log(`errors               ${col(String(proErrors))}${col(String(flErrors))} `);
}

main().catch(e => {
  console.error("[compare-models] fatal:", e);
  process.exit(1);
});
