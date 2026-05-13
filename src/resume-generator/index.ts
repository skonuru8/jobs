/**
 * index.ts — public API: generateAndSaveResume
 */

import * as path from "path";

import type { ArtifactBundleOk } from "@/shared/artifact-bundle";

import { generateResumeTex, latexStructureOk } from "./generator";
import { PROMPT_SHA } from "./prompt";
import { writeTexAndCompile } from "./saver";
import type { ResumeGenConfig, ResumeGenInput } from "./types";

export interface ResumeArtifactOutcome {
  tex_path:   string | null;
  pdf_path:   string | null;
  meta_path:  string | null;
  meta:       Record<string, unknown>;
  flags:      string[];
  word_count: number;
}

function toResumeInput(bundle: ArtifactBundleOk): ResumeGenInput {
  return {
    job: bundle.job,
    profile: bundle.profile,
    canonical_resume_tex: bundle.canonical_resume_tex,
    jd_json: bundle.jd_json as Record<string, unknown>,
    judge_json: bundle.judge_json,
    score: bundle.score,
    canonical_sha: bundle.canonical_sha,
  };
}

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
  const wMin = config.word_count_min ?? 1900;
  const wMax = config.word_count_max ?? 2500;

  const combinedMetaRel = path.relative(repoRoot, path.join(jobFolderAbs, "meta.json"));

  let gen = await generateResumeTex(input, config);
  if (gen.status !== "ok" || !gen.tex) {
    flags.push("resume_gen_failed");
    return emptyOutcome(bundle, ctx, flags, gen, combinedMetaRel);
  }

  let tex = gen.tex;

  let wc = gen.word_count;
  if (wc < wMin) {
    const hint = `Previous output was ${wc} words. Do not summarize. Produce a full-length resume between ${wMin} and ${wMax} words.`;
    const retry = await generateResumeTex(input, config, hint);
    if (retry.status === "ok" && retry.tex) {
      gen = retry;
      tex = gen.tex!;
      wc = gen.word_count;
    }
  }
  if (wc < wMin) {
    flags.push("resume_too_short");
  }

  if (!latexStructureOk(tex)) {
    flags.push("tex_malformed");
  }

  const saved = await writeTexAndCompile(tex, jobFolderAbs, config.compile_pdf !== false);
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

  return {
    tex_path:   saved.tex_path,
    pdf_path:   saved.pdf_path,
    meta_path:  path.join(jobFolderAbs, "meta.json"),
    meta,
    flags,
    word_count: wc,
  };
}

function emptyOutcome(
  bundle: ArtifactBundleOk,
  ctx: { runId: string; bucket: string; generatedBy: "pipeline" | "manual" },
  flags: string[],
  gen: { model: string; error?: string; tokens: { input: number; output: number } },
  metaRel: string,
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
      prompt_sha: PROMPT_SHA,
      canonical_sha: bundle.canonical_sha,
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
