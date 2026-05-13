import * as fs   from "fs";
import * as path from "path";

import type { ArtifactBundleOk } from "@/shared/artifact-bundle";
import type { CoverArtifactOutcome } from "@/cover-letter/saver";
import type { ResumeArtifactOutcome } from "@/resume-generator/index";

export interface ArtifactGenCtx {
  runId: string;
  bucket: string;
  generatedBy: "pipeline" | "manual";
}

export function writeCombinedMeta(
  jobFolderAbs: string,
  repoRoot: string,
  bundle: ArtifactBundleOk,
  resumeOutcome: ResumeArtifactOutcome | null,
  coverOutcome: CoverArtifactOutcome | null,
  ctx: ArtifactGenCtx,
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
      why_apply:   judge.why_apply ?? null,
      tailoring_hints: judge.tailoring_hints ?? {},
    },

    resume: resumeBlock(resumeOutcome, rel),
    cover_letter: coverBlock(coverOutcome, rel),
  };

  fs.mkdirSync(jobFolderAbs, { recursive: true });
  fs.writeFileSync(metaPath, JSON.stringify(payload, null, 2), "utf8");
  return metaPath;
}

function readReqId(meta: { [k: string]: unknown }): string | null {
  const x = meta.req_id ?? meta.requisition_id ?? (meta as { requisitionId?: unknown }).requisitionId;
  return typeof x === "string" && x.trim() ? x.trim() : null;
}

function resumeBlock(
  o: ResumeArtifactOutcome | null,
  rel: (p: string | null | undefined) => string | null,
): Record<string, unknown> {
  if (!o?.tex_path) {
    return {
      model: null, prompt_sha: null, input_tokens: null, output_tokens: null,
      word_count: null, compile_status: "skipped", flags: [],
      tex_path: null, pdf_path: null,
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
  };
}

function coverBlock(
  o: CoverArtifactOutcome | null,
  rel: (p: string | null | undefined) => string | null,
): Record<string, unknown> {
  if (!o?.tex_path) {
    return {
      model: null, prompt_sha: null, input_tokens: null, output_tokens: null,
      word_count: null, compile_status: "skipped", flags: [],
      tex_path: null, pdf_path: null,
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
  };
}
