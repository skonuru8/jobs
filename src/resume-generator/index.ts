/**
 * index.ts — Resume artifact orchestration entrypoint.
 *
 * Chooses patch vs full-regeneration mode, normalizes generator results into
 * persisted artifact metadata, applies final cleanup transforms, and returns a
 * single outcome object to pipeline or manual callers.
 *
 * Called by: `scripts/run-pipeline.ts`, `src/artifacts/manual-generate.ts`
 * Writes to: resume `.tex` / `.pdf` files through `writeTexAndCompile`
 * Side effects: file writes, LaTeX compilation, console logging
 */

import * as path from "path";

import type { ArtifactBundleOk } from "@/shared/artifact-bundle";
import { stripDashes } from "@/shared/dash-lint";
import { applyTechSwaps, applyScopedTechSwaps } from "@/shared/utils";

import { generateResumeTex, latexStructureOk } from "./generator";
import { generatePatchedResumeTex } from "./patch/orchestrator";
import { PROMPT_SHA } from "./prompt";
import { buildResumeSignature, signatureMeta } from "./signature";
import { writeTexAndCompile } from "./saver";
import type { ResumeGenConfig, ResumeGenInput } from "./types";

export interface ResumeArtifactOutcome {
  /** Absolute `.tex` artifact path, or `null` when generation or save failed. */
  tex_path:   string | null;
  /** Absolute compiled `.pdf` artifact path, or `null` when compile skipped or failed. */
  pdf_path:   string | null;
  /** Absolute metadata file path when persisted by caller, or `null` on early failure. */
  meta_path:  string | null;
  /** Metadata payload mirrored into `meta.json` by upstream persistence layer. */
  meta:       Record<string, unknown>;
  /** Pipeline flags explaining non-fatal warnings or terminal failure reasons. */
  flags:      string[];
  /** Final rendered word count used for length gating and downstream reporting. */
  word_count: number;
}

/**
 * Converts artifact bundle into generator-facing input shape.
 *
 * @param bundle - Fully assembled artifact bundle for one job.
 * @returns Resume generation input with judge-derived directives copied into optional overrides.
 */
function toResumeInput(bundle: ArtifactBundleOk): ResumeGenInput {
  return {
    job: bundle.job,
    profile: bundle.profile,
    canonical_resume_tex: bundle.canonical_resume_tex,
    jd_json: bundle.jd_json as Record<string, unknown>,
    judge_json: bundle.judge_json,
    score: bundle.score,
    canonical_sha: bundle.canonical_sha,
    gap_directives: bundle.judge_json.gap_directives,
    tech_swaps: bundle.judge_json.tailoring_hints?.tech_swaps,
  };
}

/**
 * Generates, validates, and saves resume artifacts for one job folder.
 *
 * This is pipeline-facing orchestration: it selects resume mode, applies final
 * text cleanup, emits warning flags, writes files, and assembles metadata that
 * downstream cache and UI layers can reason about deterministically.
 *
 * @param bundle - Canonical artifact bundle for current job.
 * @param config - Resume-generation and compile settings.
 * @param repoRoot - Repository root used to convert persisted paths into relative metadata paths.
 * @param jobFolderAbs - Absolute destination folder for generated resume artifacts.
 * @param ctx - Run identity and caller provenance metadata.
 * @returns Resume artifact outcome with paths, flags, metadata, and word count.
 * @throws {Error} Does not intentionally throw; file-write errors are converted into flagged outcomes.
 */
export async function generateAndSaveResume(
  bundle: ArtifactBundleOk,
  config: ResumeGenConfig,
  repoRoot: string,
  jobFolderAbs: string,
  ctx: {
    runId: string;
    bucket: string;
    generatedBy: "pipeline" | "manual";
  },
): Promise<ResumeArtifactOutcome> {
  const flags: string[] = [];
  const input = toResumeInput(bundle);
  const signature = buildResumeSignature(bundle, config);
  const wMin = config.word_count_min ?? 1900;
  const wMax = config.word_count_max ?? 2500;

  const combinedMetaRel = path.relative(repoRoot, path.join(jobFolderAbs, "meta.json"));

  let gen = signature.resume_mode === "patch_tailoring"
    ? await generatePatchedResumeTex(input, config)
    : await generateResumeTex(input, config);
  if (gen.status !== "ok" || !gen.tex) {
    flags.push("resume_gen_failed");
    console.log(`[resume] early return — reason: gen failed or empty tex (status=${gen.status})`);
    return emptyOutcome(bundle, ctx, flags, gen, combinedMetaRel, signature);
  }
  if (gen.warnings?.includes("banned_phrase_in_output")) {
    flags.push("banned_phrase_in_output");
  }
  if (gen.warnings?.includes("resume_patch_coverage_failed")) {
    flags.push("resume_patch_coverage_failed");
  }

  const strippedTex = stripDashes(gen.tex);
  // Apply scoped swaps to full tex (reaches EXPERIENCE role blocks), then replace SKILLS
  // with canonical+swapped so EXPERIENCE gets scoped swaps and SKILLS stays canonical.
  const swappedTex = (input.tech_swaps?.length ?? 0) > 0
    ? applyScopedTechSwaps(strippedTex, input.tech_swaps!)
    : strippedTex;
  let tex = boldMetrics(
    replaceSkillsSection(swappedTex, bundle.canonical_resume_tex, input.tech_swaps),
  );

  let wc = gen.word_count;
  if (wc < wMin) {
    flags.push("resume_too_short");
  }
  if (wc > wMax) {
    flags.push("resume_too_long");
  }

  if (!latexStructureOk(tex)) {
    flags.push("tex_malformed");
  }

  let saved;
  try {
    saved = await writeTexAndCompile(tex, jobFolderAbs, config.compile_pdf !== false);
  } catch (e) {
    flags.push("resume_llm_threw");
    console.log(`[resume] early return — reason: writeTexAndCompile threw: ${String(e).slice(0, 500)}`);
    return {
      tex_path: null,
      pdf_path: null,
      meta_path: null,
      meta: {
        job_id: bundle.job.meta.job_id,
        run_id: ctx.runId,
        artifact_type: "resume",
        bucket: ctx.bucket,
        generated_at: new Date().toISOString(),
        generated_by: ctx.generatedBy,
        model: gen.model,
        prompt_sha: gen.prompt_sha,
        canonical_sha: bundle.canonical_sha,
        ...signatureMeta(signature),
        input_tokens: gen.tokens.input,
        output_tokens: gen.tokens.output,
        word_count: wc,
        compile_status: "failed",
        flags,
        error: String(e).slice(0, 500),
      },
      flags,
      word_count: wc,
    };
  }
  if (!saved.pdf_path) {
    flags.push("pdf_compile_failed");
  }

  const meta: Record<string, unknown> = {
    job_id:          bundle.job.meta.job_id,
    run_id:          ctx.runId,
    artifact_type:   "resume",
    bucket:          ctx.bucket,
    generated_at:    new Date().toISOString(),
    generated_by:    ctx.generatedBy,
    model:           gen.model,
    prompt_sha:      gen.prompt_sha,
    canonical_sha:   bundle.canonical_sha,
    ...signatureMeta(signature),
    patch_prompt_sha: gen.patch?.prompt_sha ?? null,
    patch_ops:        gen.patch?.ops ?? [],
    patch_coverage:   gen.patch?.coverage ?? null,
    patch_retry_count: gen.patch?.retry_count ?? 0,
    patch_failed_directives: gen.patch?.failed_directives ?? [],
    patch_ops_dropped_unknown_role: gen.patch?.ops_dropped_unknown_role ?? 0,
    input_tokens:    gen.tokens.input,
    output_tokens:   gen.tokens.output,
    word_count:      wc,
    compile_status:  saved.pdf_path ? "ok" : "failed",
    flags,
    score:           bundle.score.total,
    judge_verdict:   bundle.judge_json.verdict,
    judge_concerns:  bundle.judge_json.concerns,
    job_meta: {
      title:            bundle.job.title,
      company:          bundle.job.company?.name ?? "",
      company_location: (bundle.job.location?.cities ?? []).join(", "),
      domain:           bundle.job.domain ?? "",
    },
    tex_path:  path.relative(repoRoot, saved.tex_path),
    pdf_path:  saved.pdf_path ? path.relative(repoRoot, saved.pdf_path) : null,
    meta_path: combinedMetaRel,
  };

  const outcome: ResumeArtifactOutcome = {
    tex_path:   saved.tex_path,
    pdf_path:   saved.pdf_path,
    meta_path:  path.join(jobFolderAbs, "meta.json"),
    meta,
    flags,
    word_count: wc,
  };

  // Safety net: if we got here with no file AND no flag, something fell through silently.
  if (!outcome.tex_path && (outcome.flags?.length ?? 0) === 0) {
    outcome.flags = [...(outcome.flags ?? []), "resume_gen_skipped_no_reason"];
    outcome.meta = {
      ...outcome.meta,
      compile_status: "skipped_unknown",
    };
    console.log("[resume] safety net triggered — no tex_path and no flags, marking skipped_unknown");
  }

  return outcome;
}

/**
 * Builds failure-shaped outcome object for early exits before persistence succeeds.
 *
 * @param bundle - Artifact bundle whose job metadata must still appear in result.
 * @param ctx - Run identity and caller provenance metadata.
 * @param flags - Failure flags accumulated so far.
 * @param gen - Terminal generator metadata, including model choice and token counts.
 * @param metaRel - Relative `meta.json` path expected by callers even on failure.
 * @param signature - Resume signature snapshot used for cache-aware metadata.
 * @returns Resume artifact outcome with null file paths and failure metadata payload.
 */
function emptyOutcome(
  bundle: ArtifactBundleOk,
  ctx: { runId: string; bucket: string; generatedBy: "pipeline" | "manual" },
  flags: string[],
  gen: { model: string; error?: string; tokens: { input: number; output: number } },
  metaRel: string,
  signature: ReturnType<typeof buildResumeSignature>,
): ResumeArtifactOutcome {
  return {
    tex_path: null,
    pdf_path: null,
    meta_path: null,
    meta: {
      job_id: bundle.job.meta.job_id,
      run_id: ctx.runId,
      artifact_type: "resume",
      bucket: ctx.bucket,
      generated_at: new Date().toISOString(),
      generated_by: ctx.generatedBy,
      model: gen.model,
      prompt_sha: signature.prompt_sha,
      canonical_sha: bundle.canonical_sha,
      ...signatureMeta(signature),
      input_tokens: gen.tokens.input,
      output_tokens: gen.tokens.output,
      word_count: 0,
      compile_status: "failed",
      flags,
      meta_path: metaRel,
      error: gen.error,
    },
    flags,
    word_count: 0,
  };
}

export type { ResumeGenConfig, ResumeGenInput, ResumeGenResult } from "./types";

/**
 * Restores canonical SKILLS section after full regeneration, with optional tech swaps applied.
 *
 * This prevents model drift from inventing or deleting skills while still
 * allowing scoped terminology normalization requested by judge output.
 *
 * @param tex - Generated resume LaTeX whose SKILLS section may need replacement.
 * @param canonicalTex - Canonical resume LaTeX that owns authoritative SKILLS content.
 * @param techSwaps - Optional replacements to apply to canonical SKILLS content before reinsertion.
 * @returns Resume LaTeX with authoritative SKILLS section restored when both sections can be located.
 */
export function replaceSkillsSection(
  tex: string,
  canonicalTex: string,
  techSwaps?: Array<{ from: string; to: string }>,
): string {
  let canonicalSkills = canonicalTex.match(
    /(\\section\*\{SKILLS\}[\s\S]*?)(?=\\section\*\{EXPERIENCE\})/,
  )?.[1];
  if (!canonicalSkills) return tex;

  if (techSwaps?.length) {
    canonicalSkills = applyTechSwaps(canonicalSkills, techSwaps);
    // Dedupe: if swap target already appears, collapse consecutive duplicate tokens on skill lines.
    // Prevents "Apache Kafka, Kafka" when Kafka already present in canonical skills.
    canonicalSkills = canonicalSkills.replace(
      /\b(\w[\w .+#-]{1,30}),\s*\1\b/gi,
      "$1",
    );
  }

  return tex.replace(
    /\\section\*\{SKILLS\}[\s\S]*?(?=\\section\*\{EXPERIENCE\})/,
    canonicalSkills,
  );
}

/**
 * Wraps standalone metric phrases in `\\textbf{}` without rebolding existing bold spans.
 *
 * @param tex - Resume LaTeX whose bullet lines may contain plain numeric outcomes.
 * @returns LaTeX with recognized metrics bolded inside item lines only.
 */
export function boldMetrics(tex: string): string {
  return tex
    .split("\n")
    .map(line => {
      if (!line.includes("\\item")) return line;
      const protectedBold: string[] = [];
      // Match \textbf{...} including one level of nested braces.
      const masked = line.replace(/\\textbf\{(?:[^{}]|\{[^{}]*\})*\}/g, m => {
        protectedBold.push(m);
        return `@@BOLD_${protectedBold.length - 1}@@`;
      });
      return masked.replace(
        /\b(\d+(?:\.\d+)?(?:\+)?\s*(?:\\?%|percent|x|ms|sec(?:onds?)?|min(?:utes?)?|hours?|days?|weeks?|months?|years?|yrs?|roles?|users?|patients?|records?|jobs?|services?|APIs?|pipelines?|components?|workflows?|reports?|claims?))(?=\s|[.,;:)]|$)/gi,
        "\\textbf{$1}",
      ).replace(/@@BOLD_(\d+)@@/g, (_, i) => protectedBold[Number(i)] ?? "");
    })
    .join("\n");
}
