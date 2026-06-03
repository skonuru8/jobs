import { stripLatex } from "@/cover-letter/resume";
import { findBannedStylePhrases } from "@/shared/style-lint";

import { latexStructureOk } from "../generator";
import type { ResumeGenConfig, ResumeGenInput, ResumeGenResult } from "../types";
import { applyPatchOps } from "./apply";
import { verifyPatchCoverage } from "./coverage";
import { activeGapDirectives, generatePatchOps, PATCH_PROMPT_SHA } from "./generator";
import { extractRoleBlocks } from "./parser";

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
    allOps = generated.ops;
    totalInput += generated.tokens.input;
    totalOutput += generated.tokens.output;
    model = generated.model;

    const tex = applyPatchOps(input.canonical_resume_tex, allOps);
    const coverage = verifyPatchCoverage(tex, directives);
    if (coverage.missed.length === 0 || attempt === 1) {
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

function countWordsTex(tex: string): number {
  const plain = stripLatex(tex);
  return plain.split(/\s+/).filter(Boolean).length;
}
