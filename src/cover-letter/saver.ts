/**
 * saver.ts — inject cover letter body into LaTeX template, compile, single job folder.
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
import { runPdflatex } from "@/shared/pdflatex";

import { generateCoverLetter } from "./generator";
import { COVER_PROMPT_SHA } from "./prompt";
import type { CoverLetterConfig, CoverLetterResult } from "./types";

export interface CoverArtifactOutcome {
  tex_path:   string | null;
  pdf_path:   string | null;
  meta_path:  string | null;
  meta:       Record<string, unknown>;
  flags:      string[];
  word_count: number;
}

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
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await runPdflatex(texAbs, jobFolderAbs);
      log = r.log;
      const expectedPdf = path.join(jobFolderAbs, "cover_letter.pdf");
      if (r.ok && fs.existsSync(expectedPdf)) {
        pdfAbs = expectedPdf;
        compileStatus = "ok";
        cleanupAuxFiles(jobFolderAbs, "cover_letter");
        break;
      }
      compileStatus = "failed";
    }
    if (!pdfAbs) {
      flags.push("pdf_compile_failed");
      fs.writeFileSync(
        path.join(jobFolderAbs, "cover_letter.compile-error.log"),
        log.slice(-24_000),
        "utf8",
      );
      cleanupAuxFiles(jobFolderAbs, "cover_letter");
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

function cleanupAuxFiles(dir: string, basename: string): void {
  for (const ext of [".aux", ".log", ".out"]) {
    const p = path.join(dir, `${basename}${ext}`);
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch { /* ignore */ }
    }
  }
}

function countWords(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

function formatLetterDate(): string {
  return new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function deriveSalutation(bundle: ArtifactBundleOk): string {
  const raw = (bundle.job.description_raw ?? "").slice(0, 12000);
  if (/\bhiring\s+manager\b/i.test(raw)) return "Manager";
  if (/\brecruiting\s+team\b|\btalent\s+acquisition\s+team\b|\bhiring\s+team\b/i.test(raw)) {
    return "Team";
  }
  return "Manager";
}

function formatCompanyLocationLine(loc: string | null | undefined): string {
  if (!loc?.trim()) return "";
  return `\\\\\n${escapeLatexPlain(loc.trim())}`;
}

export function escapeLatexBody(raw: string): string {
  let s = raw;
  s = s.replace(/\\/g, "\\textbackslash{}");
  s = s.replace(/%/g, "\\%");
  s = s.replace(/&/g, "\\&");
  s = s.replace(/\$/g, "\\$");
  s = s.replace(/#/g, "\\#");
  s = s.replace(/_/g, "\\_");
  s = s.replace(/~/g, "\\textasciitilde{}");
  s = s.replace(/\^/g, "\\textasciicircum{}");
  return s;
}

export function escapeLatexPlain(raw: string): string {
  return escapeLatexBody(raw).replace(/\n/g, " ");
}

function bodyHasLatexLeak(body: string): boolean {
  const open = (body.match(/\{/g) ?? []).length;
  const close = (body.match(/\}/g) ?? []).length;
  const hasCommand = /\\[a-zA-Z]+/.test(body);
  return open > 0 || close > 0 || hasCommand;
}

function finalTexValid(tex: string): boolean {
  const open = (tex.match(/\{/g) ?? []).length;
  const close = (tex.match(/\}/g) ?? []).length;
  return (
    tex.includes("\\begin{document}")
    && tex.includes("\\end{document}")
    && Math.abs(open - close) <= 1
  );
}

function buildMeta(args: {
  bundle: ArtifactBundleOk;
  ctx: { runId: string; bucket: string; generatedBy: "pipeline" | "manual" };
  clResult: CoverLetterResult;
  flags: string[];
  compileStatus: string;
  wordCount: number;
  canonicalSha: string;
  jobLocationLine: string | null;
  texRel?: string | null;
  pdfRel?: string | null;
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
