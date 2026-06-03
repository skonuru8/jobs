import * as fs from "fs";
import * as path from "path";

import type { ArtifactBundleOk } from "@/shared/artifact-bundle";
import type { ResumeArtifactOutcome } from "@/resume-generator/index";
import type { ResumeGenConfig } from "@/resume-generator/types";
import { buildResumeSignature } from "@/resume-generator/signature";
import { getLatestTailoredResumeForJob } from "@/storage/persist";

export async function findCachedResumeOutcome(
  repoRoot: string,
  bundle: ArtifactBundleOk,
  config: ResumeGenConfig,
): Promise<ResumeArtifactOutcome | null> {
  const prior = await getLatestTailoredResumeForJob(bundle.job.meta.job_id);
  if (!prior?.tex_path || prior.compile_status === "failed") return null;

  const signature = buildResumeSignature(bundle, config);
  if (prior.canonical_sha !== signature.canonical_sha || prior.prompt_sha !== signature.prompt_sha) {
    return null;
  }

  const meta = readMeta(repoRoot, prior.meta_path);
  const resumeMeta = (meta?.resume ?? {}) as Record<string, unknown>;
  const flags = [
    ...((Array.isArray(prior.flags) ? prior.flags : []) as string[]),
    ...((Array.isArray(resumeMeta.flags) ? resumeMeta.flags : []) as string[]),
  ];
  if (hasBlockingCacheFlag(flags) || resumeMeta.export_status === "needs_review") {
    return null;
  }
  if (
    resumeMeta.directives_hash !== signature.directives_hash ||
    resumeMeta.tech_swaps_hash !== signature.tech_swaps_hash ||
    resumeMeta.resume_mode !== signature.resume_mode
  ) {
    return null;
  }

  const texAbs = resolveRepoPath(repoRoot, prior.tex_path);
  const pdfAbs = prior.pdf_path ? resolveRepoPath(repoRoot, prior.pdf_path) : null;
  if (!fs.existsSync(texAbs)) return null;

  return {
    tex_path: texAbs,
    pdf_path: pdfAbs && fs.existsSync(pdfAbs) ? pdfAbs : null,
    meta_path: prior.meta_path ? resolveRepoPath(repoRoot, prior.meta_path) : null,
    meta: {
      ...resumeMeta,
      ...signature,
      job_id: bundle.job.meta.job_id,
      run_id: prior.run_id,
      artifact_type: "resume",
      generated_at: new Date().toISOString(),
      generated_by: "cached",
      model: prior.model,
      input_tokens: 0,
      output_tokens: 0,
      word_count: prior.word_count,
      compile_status: prior.compile_status,
      flags: ["resume_cached"],
      tex_path: prior.tex_path,
      pdf_path: prior.pdf_path,
      meta_path: prior.meta_path,
    },
    flags: ["resume_cached"],
    word_count: prior.word_count ?? 0,
  };
}

/**
 * Flags that indicate the prior artifact should NOT be reused from cache.
 * Any of these in the prior run's flags forces a fresh generation.
 *
 * - `resume_patch_coverage_failed`  — patch mode: ≥1 directive not covered after retry
 * - `resume_too_short`              — word count below word_count_min
 * - `resume_too_long`               — word count above word_count_max
 * - `tex_malformed`                 — brace imbalance or missing begin/end{document}
 * - `banned_phrase_in_output`       — hedging/transfer language present even on final attempt
 * - `pdf_compile_failed`            — latexmk compilation error (tex saved but no pdf)
 * - `resume_attribution_overrun`    — fabricated_role_attribution count > 3 in risk audit
 * - `resume_gen_failed`             — LLM call failed entirely, no tex produced
 */
export const BLOCKING_CACHE_FLAGS = new Set([
  "resume_patch_coverage_failed",
  "resume_too_short",
  "resume_too_long",
  "tex_malformed",
  "banned_phrase_in_output",
  "pdf_compile_failed",
  "resume_attribution_overrun",
  "resume_gen_failed",
]);

function hasBlockingCacheFlag(flags: string[]): boolean {
  return flags.some(f => BLOCKING_CACHE_FLAGS.has(f));
}

function readMeta(repoRoot: string, metaPath: string | null): Record<string, unknown> | null {
  if (!metaPath) return null;
  const abs = resolveRepoPath(repoRoot, metaPath);
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function resolveRepoPath(repoRoot: string, p: string): string {
  return path.isAbsolute(p) ? p : path.join(repoRoot, p);
}
