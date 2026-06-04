/**
 * orchestrator.ts — End-to-end patch tailoring flow for resume generation.
 *
 * Coordinates patch planning, deterministic application, coverage retry, and
 * final warning synthesis so patch mode can return resume artifacts shaped like
 * full generation mode without regenerating whole document.
 *
 * Called by: resume-generator/generator.ts
 * Writes to: nothing
 * Side effects: up to two LLM calls, text lint checks, LaTeX structure validation
 */

import { stripLatex } from "@/cover-letter/resume";
import { findBannedStylePhrases, hasBannedStylePhrase, stripBannedStyleClauses } from "@/shared/style-lint";

import { latexStructureOk } from "../generator";
import type { ResumeGenConfig, ResumeGenInput, ResumeGenResult } from "../types";
import { applyPatchOps } from "./apply";
import { verifyPatchCoverage } from "./coverage";
import { activeGapDirectives, generatePatchOps, PATCH_PROMPT_SHA } from "./generator";
import { extractRoleBlocks } from "./parser";

/**
 * Generates tailored resume TeX by applying LLM-planned patch ops to canonical source.
 *
 * Flow makes at most two planner attempts. First missed-coverage result feeds a
 * retry hint back into planner, then final output is linted and annotated with
 * warnings instead of hard-failing for recoverable issues like partial coverage.
 *
 * @param input - Resume generation inputs including canonical TeX and judge output.
 * @param config - Resume generation config supplying model and token limits.
 * @returns Resume generation result shaped like standard generator output.
 */
export async function generatePatchedResumeTex(
  input: ResumeGenInput,
  config: ResumeGenConfig,
): Promise<ResumeGenResult> {
  const generated_at = new Date().toISOString();
  const roleBlocks = extractRoleBlocks(input.canonical_resume_tex);
  const directives = activeGapDirectives(input.gap_directives ?? input.judge_json.gap_directives ?? []);
  let allOps = [];
  let totalInput = 0;
  let totalOutput = 0;
  let model = config.model;
  let retryCount = 0;
  let prevMissed: string[] = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    const retryHint = prevMissed.length > 0
      ? `Previously missed directives: ${prevMissed.map(r => `"${r}"`).join(", ")}. For each, add or rewrite a bullet at the directive's target_role.`
      : undefined;
    let generated;
    try {
      generated = await generatePatchOps(input, config, roleBlocks, retryHint);
    } catch (e) {
      if (attempt === 0) {
        retryCount += 1;
        continue;
      }
      return {
        status: "error",
        tex: null,
        model,
        prompt_sha: PATCH_PROMPT_SHA,
        word_count: 0,
        tokens: { input: totalInput, output: totalOutput },
        generated_at,
        error: `patch op generation failed: ${String(e).slice(0, 500)}`,
      };
    }
    allOps = sanitizePatchOps(generated.ops);
    totalInput += generated.tokens.input;
    totalOutput += generated.tokens.output;
    model = generated.model;

    const tex = applyPatchOps(input.canonical_resume_tex, allOps);
    const coverage = verifyPatchCoverage(tex, directives);
    if (coverage.missed.length === 0 || attempt === 1) {
      if (allOps.length === 0 && coverage.missed.length > 0) {
        return {
          status: "error",
          tex: null,
          model,
          prompt_sha: PATCH_PROMPT_SHA,
          word_count: 0,
          tokens: { input: totalInput, output: totalOutput },
          generated_at,
          error: `patch produced no valid ops; missed: ${coverage.missed.join("; ")}`,
        };
      }

      const warnings: string[] = [];
      if (coverage.missed.length > 0) warnings.push("resume_patch_coverage_failed");
      if (findBannedStylePhrases(tex).length > 0) warnings.push("banned_phrase_in_output");
      if (!latexStructureOk(tex)) warnings.push("tex_malformed");

      return {
        status: "ok",
        tex,
        model,
        prompt_sha: PATCH_PROMPT_SHA,
        word_count: countWordsTex(tex),
        tokens: { input: totalInput, output: totalOutput },
        generated_at,
        warnings,
        patch: {
          ops: allOps,
          coverage,
          retry_count: retryCount,
          failed_directives: coverage.missed,
          prompt_sha: PATCH_PROMPT_SHA,
        },
      } as ResumeGenResult;
    }
    prevMissed = coverage.missed;
    retryCount += 1;
  }

  return {
    status: "error",
    tex: null,
    model,
    prompt_sha: PATCH_PROMPT_SHA,
    word_count: 0,
    tokens: { input: totalInput, output: totalOutput },
    generated_at,
    error: "patch coverage failed",
  };
}

/**
 * Counts visible words in TeX after stripping markup commands.
 *
 * @param tex - Resume LaTeX source to measure.
 * @returns Approximate plain-text word count used in artifact metadata.
 */
function countWordsTex(tex: string): number {
  const plain = stripLatex(tex);
  return plain.split(/\s+/).filter(Boolean).length;
}

/**
 * Strips banned style phrases from patch op bullet text before applying to canonical TeX.
 *
 * LLMs sometimes copy banned hedging phrases from frame_as guidance into bullets verbatim.
 * This sanitizer runs deterministically after generation and before application as a
 * defense-in-depth layer that operates regardless of model compliance with the prompt.
 *
 * Drops ops whose bullet content becomes too short after stripping (< 40 chars of content),
 * since that indicates the banned phrase was load-bearing and the bullet cannot be salvaged.
 *
 * @param ops - Raw patch ops from planner, potentially containing banned phrases.
 * @returns Sanitized ops with banned clauses stripped; unsalvageable ops removed.
 */
function sanitizePatchOps(ops: import("./types").PatchOp[]): import("./types").PatchOp[] {
  return ops
    .map(op => {
      const field = op.type === "rewrite" ? "new_item" : "item";
      const raw = (op as Record<string, unknown>)[field] as string;
      if (!hasBannedStylePhrase(raw)) return op;

      const cleaned = stripBannedStyleClauses(raw);
      const contentLen = cleaned.replace(/\\item\s*/, "").replace(/\\[a-zA-Z]+\{[^}]*\}/g, "x").replace(/[{}\\]/g, "").trim().length;
      if (hasBannedStylePhrase(cleaned) || contentLen < 40) {
        console.warn(`[patch] sanitizePatchOps: dropped op — residual banned phrase or empty content after strip in role "${op.role}"`);
        return null;
      }
      console.log(`[patch] sanitizePatchOps: stripped banned phrase from bullet in role "${op.role}"`);
      return { ...op, [field]: cleaned };
    })
    .filter(Boolean) as import("./types").PatchOp[];
}
