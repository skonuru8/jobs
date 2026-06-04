/**
 * saver.ts — persist generated cover letters into LaTeX/PDF artifacts.
 *
 * Converts bundle-derived cover letter input into final template substitutions,
 * validates generated prose for obvious LaTeX hazards, writes artifact files,
 * and records metadata for downstream pipeline consumers.
 *
 * Called by: pipeline artifact generation flows, manual artifact generation
 * Writes to: job artifact folder (`cover_letter.tex`, optional `cover_letter.pdf`, compile logs)
 * Side effects: filesystem writes, optional `pdflatex` invocation, date generation
 */

import * as fs   from "fs";
import * as path from "path";

import type { ArtifactBundleOk } from "@/shared/artifact-bundle";
import {
  coverLetterInputFromBundle,
  hasExtendedJudgeContext,
  buildSlimJdForPrompts,
  buildSlimProfileForPrompts,
} from "@/shared/artifact-bundle";
import { cleanupAuxFiles, runPdflatex } from "@/shared/pdflatex";
import { countWords } from "./generator";
export { escapeLatexBody, escapeLatexPlain } from "./latex-utils";
import {
  bodyHasLatexLeak,
  deriveSalutation,
  escapeLatexBody,
  escapeLatexPlain,
  finalTexValid,
  formatCompanyLocationLine,
  formatLetterDate,
} from "./latex-utils";

import { generateCoverLetter } from "./generator";
import { COVER_PROMPT_SHA } from "./prompt";
import type { CoverLetterConfig, CoverLetterResult } from "./types";

export interface CoverArtifactOutcome {
  /** Absolute path to generated `.tex` artifact, or null when generation failed early. */
  tex_path:   string | null;
  /** Absolute path to compiled `.pdf` artifact, or null when compile skipped or failed. */
  pdf_path:   string | null;
  /** Absolute path where cover-letter metadata should be persisted by caller. */
  meta_path:  string | null;
  /** Metadata payload describing prompt provenance, status, and artifact paths. */
  meta:       Record<string, unknown>;
  /** Artifact flags describing recoverable generation or compile problems. */
  flags:      string[];
  /** Final cover letter body word count used for QA thresholds. */
  word_count: number;
}

/**
 * Generates cover letter prose from artifact bundle context and writes templated outputs.
 *
 * Uses slimmed JD/profile context when extended judge metadata is available, then
 * injects generated prose into the LaTeX template, optionally compiles a PDF, and
 * returns artifact metadata plus any quality flags the caller should persist.
 *
 * @param bundle - Fully hydrated artifact bundle for one job/application pair.
 * @param config - Cover letter generation and compile configuration.
 * @param repoRoot - Repository root used to resolve template and relative artifact paths.
 * @param jobFolderAbs - Absolute artifact folder for this job run.
 * @param ctx - Run metadata used in returned artifact provenance.
 * @returns Generated artifact paths, metadata payload, flags, and word count summary.
 * @throws {Error} Propagates filesystem, generator, or `pdflatex` errors not converted into flags.
 */
export async function generateAndSaveCoverLetter(
  bundle: ArtifactBundleOk,
  config: CoverLetterConfig,
  repoRoot: string,
  jobFolderAbs: string,
  ctx: {
    runId: string;
    bucket: string;
    generatedBy: "pipeline" | "manual";
  },
): Promise<CoverArtifactOutcome> {
  const flags: string[] = [];
  const input = coverLetterInputFromBundle(bundle);
  const jobLocationLine = input.job.location_line ?? null;

  const jdForLlm = hasExtendedJudgeContext(bundle.judge_json)
    ? buildSlimJdForPrompts(bundle.jd_json as Record<string, unknown>)
    : (bundle.jd_json as Record<string, unknown>);
  const profileForLlm = hasExtendedJudgeContext(bundle.judge_json)
    ? buildSlimProfileForPrompts(
        bundle.profile,
        (bundle.job.required_skills ?? []).map(s => s.name),
      )
    : {
        skills: input.profile.skills,
        years_experience: input.profile.years_experience,
        education: input.profile.education,
        preferred_domains: input.profile.preferred_domains,
        work_authorization: input.profile.work_authorization,
        contact: input.profile.contact,
        title: input.profile.title,
        location_line: input.profile.location_line,
      };

  const clResult = await generateCoverLetter(
    input,
    config,
    jdForLlm,
    bundle.judge_json as Record<string, unknown>,
    profileForLlm,
  );
  if (clResult.status !== "ok" || !clResult.text) {
    flags.push("cover_letter_gen_failed");
    return {
      tex_path: null,
      pdf_path: null,
      meta_path: null,
      meta: buildMeta({
        bundle, ctx, clResult, flags, compileStatus: "failed",
        wordCount: 0, canonicalSha: bundle.canonical_sha,
        jobLocationLine,
      }),
      flags,
      word_count: 0,
    };
  }

  const wc = clResult.word_count ?? countWords(clResult.text);
  if (wc < 350 || wc > 600) {
    flags.push("cover_letter_length_off");
  }

  if (bodyHasLatexLeak(clResult.text)) {
    flags.push("cover_body_latex_leak");
  }

  const templatePath = path.join(repoRoot, "config", "cover_letter_template.tex");
  if (!fs.existsSync(templatePath)) {
    flags.push("cover_letter_template_missing");
    return {
      tex_path: null,
      pdf_path: null,
      meta_path: null,
      meta: buildMeta({
        bundle, ctx, clResult, flags, compileStatus: "failed",
        wordCount: wc, canonicalSha: bundle.canonical_sha,
        jobLocationLine,
      }),
      flags,
      word_count: wc,
    };
  }

  const template = fs.readFileSync(templatePath, "utf8");
  const salutation = deriveSalutation(bundle);
  const companyLoc = formatCompanyLocationLine(input.job.location_line);
  const reqSuffix = input.job.req_id?.trim()
    ? ` (Req. ${escapeLatexPlain(input.job.req_id!.trim())})`
    : "";

  const subs: Record<string, string> = {
    NAME:                  escapeLatexPlain(input.profile.contact.name),
    TITLE_ROLE:            escapeLatexPlain(input.profile.title ?? "Senior Software Engineer"),
    LOCATION_LINE:         escapeLatexPlain(input.profile.location_line ?? ""),
    EMAIL:                 escapeLatexPlain(input.profile.contact.email),
    PHONE:                 escapeLatexPlain(input.profile.contact.phone),
    LINKEDIN:              escapeLatexPlain(input.profile.contact.linkedin),
    GITHUB:                escapeLatexPlain(input.profile.contact.github),
    DATE:                  escapeLatexPlain(formatLetterDate()),
    SALUTATION:            salutation,
    COMPANY_NAME:          escapeLatexPlain(input.job.company),
    COMPANY_LOCATION_LINE: companyLoc,
    ROLE_TITLE:            escapeLatexPlain(input.job.title),
    REQ_ID_SUFFIX:         reqSuffix,
    BODY:                  escapeLatexBody(clResult.text),
  };

  let tex = template;
  for (const [k, v] of Object.entries(subs)) {
    tex = tex.split(`<<${k}>>`).join(v);
  }

  if (!finalTexValid(tex)) {
    flags.push("tex_malformed");
  }

  fs.mkdirSync(jobFolderAbs, { recursive: true });
  const texAbs = path.join(jobFolderAbs, "cover_letter.tex");
  fs.writeFileSync(texAbs, tex, "utf8");

  let pdfAbs: string | null = null;
  let compileStatus: "ok" | "failed" = "ok";
  if (config.compile_pdf !== false) {
    let log = "";
    const expectedPdf = path.join(jobFolderAbs, "cover_letter.pdf");
    // Delete stale PDF before compile so existence check reflects this run.
    if (fs.existsSync(expectedPdf)) {
      fs.unlinkSync(expectedPdf);
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await runPdflatex(texAbs, jobFolderAbs);
      log = r.log;
      if (fs.existsSync(expectedPdf)) {
        pdfAbs = expectedPdf;
        compileStatus = "ok";
        cleanupAuxFiles(jobFolderAbs, "cover_letter");
        break;
      }
      compileStatus = "failed";
    }
    if (!pdfAbs) {
      flags.push("pdf_compile_failed");
      // Failure — keep aux files for debugging, write compile-error log
      fs.writeFileSync(
        path.join(jobFolderAbs, "cover_letter.compile-error.log"),
        log.slice(-24_000),
        "utf8",
      );
    }
  }

  const combinedMetaRel = path.relative(repoRoot, path.join(jobFolderAbs, "meta.json"));
  const meta = buildMeta({
    bundle,
    ctx,
    clResult,
    flags,
    compileStatus,
    wordCount: wc,
    canonicalSha: bundle.canonical_sha,
    texRel: path.relative(repoRoot, texAbs),
    pdfRel: pdfAbs ? path.relative(repoRoot, pdfAbs) : null,
    metaRel: combinedMetaRel,
    jobLocationLine,
  });

  return {
    tex_path:   texAbs,
    pdf_path:   pdfAbs,
    meta_path:  path.join(jobFolderAbs, "meta.json"),
    meta,
    flags,
    word_count: wc,
  };
}

/**
 * Builds metadata payload stored alongside generated cover letter artifacts.
 *
 * @param args - Artifact provenance, generation result, and optional relative paths.
 * @returns Serializable metadata object written into per-job artifact records.
 */
function buildMeta(args: {
  /** Source bundle supplying score, job, and judge context. */
  bundle: ArtifactBundleOk;
  /** Run-level provenance fields copied into artifact metadata. */
  ctx: { runId: string; bucket: string; generatedBy: "pipeline" | "manual" };
  /** Raw cover letter generation result from model orchestration. */
  clResult: CoverLetterResult;
  /** Artifact flags accumulated during generation and compile checks. */
  flags: string[];
  /** Final compile state string stored in metadata for downstream triage. */
  compileStatus: string;
  /** Final measured word count of generated body text. */
  wordCount: number;
  /** Canonical resume hash used to tie artifact back to source resume state. */
  canonicalSha: string;
  /** Human-readable job location line persisted in `job_meta`. */
  jobLocationLine: string | null;
  /** Optional repo-relative path to generated `.tex` artifact. */
  texRel?: string | null;
  /** Optional repo-relative path to generated `.pdf` artifact. */
  pdfRel?: string | null;
  /** Optional repo-relative path to persisted artifact metadata file. */
  metaRel?: string | null;
}): Record<string, unknown> {
  const { bundle, ctx, clResult, flags, compileStatus, wordCount, canonicalSha } = args;
  const job = bundle.job;
  const locLine = args.jobLocationLine;
  return {
    job_id:          job.meta.job_id,
    run_id:          ctx.runId,
    artifact_type:   "cover_letter",
    bucket:          ctx.bucket,
    generated_at:    new Date().toISOString(),
    generated_by:    ctx.generatedBy,
    model:           clResult.model,
    prompt_sha:      clResult.prompt_sha ?? COVER_PROMPT_SHA,
    canonical_sha:   canonicalSha,
    input_tokens:    clResult.input_tokens ?? null,
    output_tokens:   clResult.output_tokens ?? null,
    word_count:      wordCount,
    compile_status:  compileStatus,
    flags,
    error:           clResult.error ?? null,
    score:           bundle.score.total,
    judge_verdict:   bundle.judge_json.verdict,
    judge_concerns:  bundle.judge_json.concerns,
    job_meta: {
      title:             job.title,
      company:           job.company?.name ?? "",
      company_location:  locLine ?? "",
      domain:            job.domain ?? "",
    },
    tex_path:  args.texRel ?? null,
    pdf_path:  args.pdfRel ?? null,
    meta_path: args.metaRel ?? null,
  };
}
