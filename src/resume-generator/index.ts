/**
 * index.ts — public API: generateAndSaveResume
 */

import * as path from "path";

import type { ArtifactBundleOk } from "@/shared/artifact-bundle";
import { stripDashes } from "@/shared/dash-lint";

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
    gap_directives: bundle.judge_json.gap_directives,
    tech_swaps: bundle.judge_json.tailoring_hints?.tech_swaps,
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
    console.log(`[resume] early return — reason: gen failed or empty tex (status=${gen.status})`);
    return emptyOutcome(bundle, ctx, flags, gen, combinedMetaRel);
  }

  let tex = boldMetrics(replaceSkillsSection(stripDashes(gen.tex), bundle.canonical_resume_tex));

  let wc = gen.word_count;
  if (wc < wMin) {
    flags.push("resume_too_short");
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

export function replaceSkillsSection(tex: string, canonicalTex: string): string {
  const canonicalSkills = canonicalTex.match(
    /(\\section\*\{SKILLS\}[\s\S]*?)(?=\\section\*\{EXPERIENCE\})/,
  )?.[1];
  if (!canonicalSkills) return tex;
  return tex.replace(
    /\\section\*\{SKILLS\}[\s\S]*?(?=\\section\*\{EXPERIENCE\})/,
    canonicalSkills,
  );
}

export function boldMetrics(tex: string): string {
  return tex
    .split("\n")
    .map(line => {
      if (!line.includes("\\item")) return line;
      const protectedBold: string[] = [];
      const masked = line.replace(/\\textbf\{[^{}]*\}/g, m => {
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
