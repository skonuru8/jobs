/**
 * resume-cache.ts — Resume artifact cache lookup for manual and pipeline runs.
 *
 * Reuses prior tailored resume artifacts only when canonical input, prompt
 * lineage, directive hashes, and blocking-risk flags all still match current
 * generation intent.
 *
 * Called by: manual-generate.ts, pipeline artifact generation flows
 * Side effects: reads persisted artifact row, meta.json, and on-disk tex/pdf existence
 */
import * as fs from "fs";
import * as path from "path";

import type { ArtifactBundleOk } from "@/shared/artifact-bundle";
import type { ResumeArtifactOutcome } from "@/resume-generator/index";
import type { ResumeGenConfig } from "@/resume-generator/types";
import { buildResumeSignature } from "@/resume-generator/signature";
import { getLatestTailoredResumeForJob } from "@/storage/persist";

/**
 * Finds reusable tailored resume artifact for current job and generation config.
 *
 * Cache acceptance is intentionally strict: any compile failure, human-review
 * export status, missing file, or signature mismatch forces fresh generation.
 *
 * @param repoRoot - Repository root used to resolve stored relative artifact paths.
 * @param bundle - Validated artifact bundle for current job snapshot.
 * @param config - Resume generation config whose mode and prompts affect signature.
 * @returns Cached resume artifact outcome when prior artifact is safe to reuse, otherwise `null`.
 */
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

/**
 * Checks whether any persisted artifact flags disqualify cache reuse.
 *
 * @param flags - Combined artifact and metadata flags from prior generation.
 * @returns `true` when at least one flag requires regenerating the resume.
 */
function hasBlockingCacheFlag(flags: string[]): boolean {
  return flags.some(f => BLOCKING_CACHE_FLAGS.has(f));
}

/**
 * Reads prior artifact metadata JSON when cache lookup needs fine-grained fields.
 *
 * Metadata parse failure is treated as cache miss rather than hard error because
 * regeneration is safer than trusting incomplete cache state.
 *
 * @param repoRoot - Repository root used to resolve stored relative meta paths.
 * @param metaPath - Persisted meta.json path from artifact storage, if any.
 * @returns Parsed metadata object or `null` when path is absent, unreadable, or invalid JSON.
 */
function readMeta(repoRoot: string, metaPath: string | null): Record<string, unknown> | null {
  if (!metaPath) return null;
  const abs = resolveRepoPath(repoRoot, metaPath);
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Resolves stored artifact paths against repo root when they are not absolute.
 *
 * @param repoRoot - Repository root used by local artifact storage.
 * @param p - Stored artifact path, absolute or repo-relative.
 * @returns Absolute filesystem path for existence checks and file reads.
 */
function resolveRepoPath(repoRoot: string, p: string): string {
  return path.isAbsolute(p) ? p : path.join(repoRoot, p);
}
