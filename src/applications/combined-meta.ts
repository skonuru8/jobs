/**
 * combined-meta.ts — writes consolidated per-job artifact metadata.
 *
 * Builds `meta.json` beside generated resume and cover letter artifacts so UI,
 * audits, and replay tooling can inspect one normalized payload instead of
 * recomputing fields from multiple sources.
 *
 * Called by: application artifact generation flows
 * Writes to: `meta.json` inside per-job artifact folder
 * Side effects: creates destination folder and writes one JSON file
 */
import * as fs   from "fs";
import * as path from "path";

import type { ArtifactBundleOk } from "@/shared/artifact-bundle";
import type { CoverArtifactOutcome } from "@/cover-letter/saver";
import type { ResumeArtifactOutcome } from "@/resume-generator/index";
import type { EvalResult } from "@/evals/types";

export interface ArtifactGenCtx {
  /** Run id associated with artifact generation; may point to orchestrated or manual flow. */
  runId: string;
  /** Judge bucket assigned to job and copied into combined metadata. */
  bucket: string;
  /** Origin of artifact generation request. */
  generatedBy: "pipeline" | "manual";
}

/**
 * Writes normalized artifact metadata for one job folder.
 *
 * Relative paths are stored instead of absolute paths so bundles remain portable
 * across machines and archive locations.
 *
 * @param jobFolderAbs - Absolute destination folder for this job's artifacts.
 * @param repoRoot - Repository root used to relativize artifact file paths.
 * @param bundle - Validated artifact bundle containing job, score, and judge data.
 * @param resumeOutcome - Resume generation result, or `null` when resume was skipped.
 * @param coverOutcome - Cover letter generation result, or `null` when cover letter was skipped.
 * @param ctx - Run metadata that links artifacts back to pipeline or manual execution.
 * @returns Absolute path to written `meta.json` file.
 * @throws {Error} Propagates filesystem errors from directory creation or file write.
 */
export function writeCombinedMeta(
  jobFolderAbs: string,
  repoRoot: string,
  bundle: ArtifactBundleOk,
  resumeOutcome: ResumeArtifactOutcome | null,
  coverOutcome: CoverArtifactOutcome | null,
  ctx: ArtifactGenCtx,
  evals?: EvalResult | null,
  regenerationReason?: string | null,
): string {
  const job = bundle.job;
  const metaPath = path.join(jobFolderAbs, "meta.json");
  const rel = (p: string | null | undefined) =>
    p ? path.relative(repoRoot, p).replace(/\\/g, "/") : null;

  const judge = bundle.judge_json;
  const concerns = Array.isArray(judge.concerns) ? judge.concerns : [];

  const payload = {
    job_id:        job.meta.job_id,
    run_id:        ctx.runId,
    generated_at:  new Date().toISOString(),
    generated_by:  ctx.generatedBy,
    bucket:        ctx.bucket,
    canonical_sha: bundle.canonical_sha,

    job_meta: {
      title:            job.title ?? "",
      company:          job.company?.name ?? "",
      company_location: (job.location?.cities ?? []).concat(job.location?.countries ?? []).filter(Boolean).join(", ") || "",
      domain:           job.domain ?? "",
      source_url:       job.meta.source_url ?? "",
      posted_at:        job.meta.posted_at ? String(job.meta.posted_at).slice(0, 10) : null,
      req_id:           readReqId(job.meta as unknown as Record<string, unknown>),
    },

    score: bundle.score.total,
    judge: {
      verdict:    judge.verdict ?? null,
      confidence: judge.confidence ?? null,
      reasoning:  judge.reasoning ?? "",
      concerns,
      key_matches: judge.key_matches ?? [],
      gaps:        judge.gaps ?? [],
      gap_directives: judge.gap_directives ?? [],
      why_apply:   judge.why_apply ?? null,
      tailoring_hints: judge.tailoring_hints ?? {},
    },

    resume: resumeBlock(resumeOutcome, rel),
    cover_letter: coverBlock(coverOutcome, rel),
    ...(evals ? { evals } : {}),
    ...(regenerationReason != null ? { regeneration_reason: regenerationReason } : {}),
  };

  fs.mkdirSync(jobFolderAbs, { recursive: true });
  fs.writeFileSync(metaPath, JSON.stringify(payload, null, 2), "utf8");
  return metaPath;
}

/**
 * Extracts requisition identifier from heterogeneous scraper metadata shapes.
 *
 * Supports historical key variants so downstream metadata stays stable while
 * upstream scrapers evolve independently.
 *
 * @param meta - Raw job metadata object from scraper output.
 * @returns Trimmed requisition id, or `null` when no usable field exists.
 */
function readReqId(meta: { [k: string]: unknown }): string | null {
  const x = meta.req_id ?? meta.requisition_id ?? (meta as { requisitionId?: unknown }).requisitionId;
  return typeof x === "string" && x.trim() ? x.trim() : null;
}

/**
 * Converts resume generation outcome into normalized `resume` block for `meta.json`.
 *
 * Emits explicit skip and failure placeholders so consumers can distinguish
 * "not generated" from "generated but unusable" without inspecting other files.
 *
 * @param o - Resume generation outcome, or `null` when stage never ran.
 * @param rel - Helper that converts absolute paths into repository-relative paths.
 * @returns JSON-safe object describing resume artifact status and metadata.
 */
function resumeBlock(
  o: ResumeArtifactOutcome | null,
  rel: (p: string | null | undefined) => string | null,
): Record<string, unknown> {
  if (o === null) {
    return {
      model: null, prompt_sha: null, input_tokens: null, output_tokens: null,
      word_count: null, compile_status: "skipped", flags: ["resume_gen_skipped_no_reason"],
      tex_path: null, pdf_path: null,
      risk_summary: null, export_status: "skipped",
      resume_mode: null, directives_hash: null, tech_swaps_hash: null,
      patch_prompt_sha: null, patch_ops: [], patch_coverage: null,
      patch_retry_count: null, patch_failed_directives: [],
    };
  }
  if (!o.tex_path) {
    const flags = (o.flags?.length ?? 0) > 0
      ? o.flags
      : ["resume_gen_skipped_no_reason"];
    return {
      model:          o.meta?.model ?? null,
      prompt_sha:     o.meta?.prompt_sha ?? null,
      resume_mode:    o.meta?.resume_mode ?? null,
      directives_hash: o.meta?.directives_hash ?? null,
      tech_swaps_hash: o.meta?.tech_swaps_hash ?? null,
      patch_prompt_sha: o.meta?.patch_prompt_sha ?? null,
      patch_ops:      o.meta?.patch_ops ?? [],
      patch_coverage: o.meta?.patch_coverage ?? null,
      patch_retry_count: o.meta?.patch_retry_count ?? null,
      patch_failed_directives: o.meta?.patch_failed_directives ?? [],
      input_tokens:   o.meta?.input_tokens ?? null,
      output_tokens:  o.meta?.output_tokens ?? null,
      word_count:     o.word_count ?? null,
      compile_status: o.meta?.compile_status ?? "skipped_unknown",
      flags,
      error:          (o.meta as Record<string, unknown>)?.error ?? null,
      tex_path: null, pdf_path: null,
      risk_summary: null, export_status: (o.meta as Record<string, unknown>).export_status ?? "failed",
    };
  }
  const m = o.meta;
  return {
    model:          m.model ?? null,
    prompt_sha:     m.prompt_sha ?? null,
    resume_mode:    m.resume_mode ?? null,
    directives_hash: m.directives_hash ?? null,
    tech_swaps_hash: m.tech_swaps_hash ?? null,
    patch_prompt_sha: m.patch_prompt_sha ?? null,
    patch_ops:      m.patch_ops ?? [],
    patch_coverage: m.patch_coverage ?? null,
    patch_retry_count: m.patch_retry_count ?? null,
    patch_failed_directives: m.patch_failed_directives ?? [],
    input_tokens:   m.input_tokens ?? null,
    output_tokens:  m.output_tokens ?? null,
    word_count:     o.word_count,
    compile_status: m.compile_status ?? "unknown",
    flags:            o.flags,
    tex_path:         rel(o.tex_path),
    pdf_path:         rel(o.pdf_path),
    risk_summary:   (m as Record<string, unknown>).risk_summary ?? null,
    export_status:  (m as Record<string, unknown>).export_status ?? "ok",
  };
}

/**
 * Converts cover letter generation outcome into normalized `cover_letter` block.
 *
 * Keeps schema aligned with resume metadata so downstream readers can handle
 * skips, failures, and successful exports with predictable keys.
 *
 * @param o - Cover letter generation outcome, or `null` when stage never ran.
 * @param rel - Helper that converts absolute paths into repository-relative paths.
 * @returns JSON-safe object describing cover letter artifact status and metadata.
 */
function coverBlock(
  o: CoverArtifactOutcome | null,
  rel: (p: string | null | undefined) => string | null,
): Record<string, unknown> {
  if (!o?.tex_path) {
    return {
      model:          o?.meta?.model ?? null,
      prompt_sha:     o?.meta?.prompt_sha ?? null,
      input_tokens:   o?.meta?.input_tokens ?? null,
      output_tokens:  o?.meta?.output_tokens ?? null,
      word_count:     o?.word_count ?? null,
      compile_status: (o?.meta?.compile_status as string) ?? (o ? "failed" : "skipped"),
      flags:          o?.flags ?? [],
      error:          (o?.meta as Record<string, unknown> | undefined)?.error ?? null,
      tex_path: null, pdf_path: null,
      risk_summary: null, export_status: (o?.meta as Record<string, unknown> | undefined)?.export_status ?? (o ? "failed" : "skipped"),
    };
  }
  const m = o.meta;
  return {
    model:          m.model ?? null,
    prompt_sha:     m.prompt_sha ?? null,
    input_tokens:   m.input_tokens ?? null,
    output_tokens:  m.output_tokens ?? null,
    word_count:     o.word_count,
    compile_status: m.compile_status ?? "unknown",
    flags:            o.flags,
    tex_path:         rel(o.tex_path),
    pdf_path:         rel(o.pdf_path),
    risk_summary:   (m as Record<string, unknown>).risk_summary ?? null,
    export_status:  (m as Record<string, unknown>).export_status ?? "ok",
  };
}
