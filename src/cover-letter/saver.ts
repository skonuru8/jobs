/**
 * saver.ts — inject cover letter body into LaTeX template, compile, version files.
 */

import * as fs   from "fs";
import * as path from "path";

import type { ArtifactBundleOk } from "@/shared/artifact-bundle";
import { coverLetterInputFromBundle } from "@/shared/artifact-bundle";
import { runPdflatex, pdflatexLogSuggestsSuccess } from "@/shared/pdflatex";

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
  version: number,
  ctx: {
    runId: string;
    bucket: string;
    generatedBy: "pipeline" | "manual";
  },
): Promise<CoverArtifactOutcome> {
  const flags: string[] = [];
  const input = coverLetterInputFromBundle(bundle);

  const clResult = await generateCoverLetter(input, config, bundle.jd_json, bundle.judge_json);
  if (clResult.status !== "ok" || !clResult.text) {
    flags.push("cover_letter_gen_failed");
    return {
      tex_path: null,
      pdf_path: null,
      meta_path: null,
      meta: buildMeta({
        bundle, ctx, clResult, version, flags, compileStatus: "failed",
        wordCount: 0, canonicalSha: bundle.canonical_sha,
      }),
      flags,
      word_count: 0,
    };
  }

  const wc = clResult.word_count ?? countWords(clResult.text);
  if (wc < 350 || wc > 600) {
    flags.push("cover_letter_length_off");
  }

  if (!basicTexSanity(clResult.text)) {
    flags.push("tex_malformed");
  }

  const templatePath = path.join(repoRoot, "config", "cover_letter_template.tex");
  if (!fs.existsSync(templatePath)) {
    flags.push("cover_letter_template_missing");
    return {
      tex_path: null,
      pdf_path: null,
      meta_path: null,
      meta: buildMeta({
        bundle, ctx, clResult, version, flags, compileStatus: "failed",
        wordCount: wc, canonicalSha: bundle.canonical_sha,
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

  fs.mkdirSync(jobFolderAbs, { recursive: true });
  const vBase = `v${version}`;
  const texAbs = path.join(jobFolderAbs, `${vBase}.tex`);
  fs.writeFileSync(texAbs, tex, "utf8");

  let pdfAbs: string | null = null;
  let compileStatus: "ok" | "failed" = "ok";
  if (config.compile_pdf !== false) {
    let log = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await runPdflatex(texAbs, jobFolderAbs);
      log = r.log;
      if (r.ok && pdflatexLogSuggestsSuccess(log)) {
        const expectedPdf = path.join(jobFolderAbs, `${vBase}.pdf`);
        if (fs.existsSync(expectedPdf)) {
          pdfAbs = expectedPdf;
          compileStatus = "ok";
          break;
        }
      }
      compileStatus = "failed";
    }
    if (!pdfAbs) {
      flags.push("pdf_compile_failed");
      fs.writeFileSync(
        path.join(jobFolderAbs, `${vBase}.compile-error.log`),
        log.slice(-24_000),
        "utf8",
      );
    }
  }

  const meta = buildMeta({
    bundle,
    ctx,
    clResult,
    version,
    flags,
    compileStatus,
    wordCount: wc,
    canonicalSha: bundle.canonical_sha,
    texRel: path.relative(repoRoot, texAbs),
    pdfRel: pdfAbs ? path.relative(repoRoot, pdfAbs) : null,
    metaRel: path.relative(repoRoot, path.join(jobFolderAbs, `${vBase}.meta.json`)),
  });

  const metaAbs = path.join(jobFolderAbs, `${vBase}.meta.json`);
  fs.writeFileSync(metaAbs, JSON.stringify(meta, null, 2), "utf8");

  copyLatest(jobFolderAbs, vBase, !!pdfAbs);

  return {
    tex_path:   texAbs,
    pdf_path:   pdfAbs,
    meta_path:  metaAbs,
    meta,
    flags,
    word_count: wc,
  };
}

function copyLatest(dir: string, vBase: string, hasPdf: boolean): void {
  const tex = path.join(dir, `${vBase}.tex`);
  fs.copyFileSync(tex, path.join(dir, "latest.tex"));
  if (hasPdf) {
    const pdf = path.join(dir, `${vBase}.pdf`);
    fs.copyFileSync(pdf, path.join(dir, "latest.pdf"));
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

function deriveSalutation(_bundle: ArtifactBundleOk): string {
  return "Manager";
}

function formatCompanyLocationLine(loc: string | null | undefined): string {
  if (!loc?.trim()) return "";
  return `\\\\\n${escapeLatexPlain(loc.trim())}`;
}

/** Escape prose for LaTeX body — backslashes first. */
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

function basicTexSanity(body: string): boolean {
  const open = (body.match(/\{/g) ?? []).length;
  const close = (body.match(/\}/g) ?? []).length;
  return Math.abs(open - close) <= 2;
}

function buildMeta(args: {
  bundle: ArtifactBundleOk;
  ctx: { runId: string; bucket: string; generatedBy: "pipeline" | "manual" };
  clResult: CoverLetterResult;
  version: number;
  flags: string[];
  compileStatus: string;
  wordCount: number;
  canonicalSha: string;
  texRel?: string | null;
  pdfRel?: string | null;
  metaRel?: string | null;
}): Record<string, unknown> {
  const { bundle, ctx, clResult, version, flags, compileStatus, wordCount, canonicalSha } = args;
  const job = bundle.job;
  const locLine = coverLetterInputFromBundle(bundle).job.location_line;
  return {
    job_id:          job.meta.job_id,
    run_id:          ctx.runId,
    version,
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
