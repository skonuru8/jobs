/**
 * Manual artifact generation (resume + cover) for UI / API.
 * Shares logic with the pipeline; requires OPENROUTER_API_KEY and Postgres.
 */

import * as fs   from "fs";
import * as path from "path";

import { validateProfile } from "@/filter/validate";
import { generateAndSaveCoverLetter } from "@/cover-letter/saver";
import type { CoverLetterConfig } from "@/cover-letter/types";
import { loadCanonicalResumeMaster } from "@/cover-letter/resume";
import { buildExperienceBlockFromCanonicalTex } from "@/cover-letter/resume-brief";
import { generateAndSaveResume } from "@/resume-generator/index";
import type { ResumeGenConfig } from "@/resume-generator/types";
import { buildArtifactBundle } from "@/shared/artifact-bundle";
import { makeJobSlug } from "@/shared/slug";
import { makeManualFolderName } from "@/applications/run-folder";
import { fetchLatestJobSnapshotForArtifacts } from "@/storage/artifact-load";
import {
  insertCoverLetterArtifact,
  insertTailoredResumeArtifact,
  insertLedgerEntries,
  jobHasCompleteArtifacts,
} from "@/storage/persist";
import { writeJobDescription } from "@/applications/job-description-writer";
import { writeCombinedMeta } from "@/applications/combined-meta";
import { auditTailoredArtifact, applyResumeAttributionOverrunFlag, isRiskMapLoaded, loadRiskMap } from "@/risk-map";

export interface ManualGenerateResult {
  ok: boolean;
  /** True when force was false and rows already exist (HTTP 409). */
  conflict?: boolean;
  error?: string;
  resume?: Record<string, unknown> | null;
  cover?:  Record<string, unknown> | null;
}

export async function manualGenerateArtifacts(
  repoRoot: string,
  jobId: string,
  options?: { force?: boolean },
): Promise<ManualGenerateResult> {
  const manualLog = createManualGenerationLog(repoRoot, jobId);
  manualLog(`start job_id=${jobId} force=${String(options?.force)}`);

  if (!isRiskMapLoaded()) {
    loadRiskMap(repoRoot);
  }

  if (options?.force === false && (await jobHasCompleteArtifacts(jobId))) {
    manualLog("conflict complete_artifacts_exist");
    return {
      ok: false,
      conflict: true,
      error: "Complete artifacts already exist for this job. Set force to true to regenerate.",
    };
  }

  const snapshot = await fetchLatestJobSnapshotForArtifacts(jobId);
  if (!snapshot) {
    manualLog("failed missing_snapshot");
    return { ok: false, error: "Job not found or missing score/judge data." };
  }

  const profilePath = path.join(repoRoot, "config", "profile.json");
  if (!fs.existsSync(profilePath)) {
    manualLog("failed profile_missing");
    return { ok: false, error: "profile.json missing" };
  }
  const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  try {
    validateProfile(profile);
  } catch (e) {
    manualLog(`failed profile_invalid error=${String(e).slice(0, 500)}`);
    return { ok: false, error: `Profile invalid: ${e}` };
  }

  const configPath = path.join(repoRoot, "config", "config.json");
  if (!fs.existsSync(configPath)) {
    manualLog("failed config_missing");
    return { ok: false, error: "config.json missing" };
  }
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

  const canonicalResumeTex = loadCanonicalResumeMaster(repoRoot);
  if (!canonicalResumeTex) {
    manualLog("failed canonical_missing");
    return { ok: false, error: "config/resume_master.tex missing" };
  }

  const experienceBlock = buildExperienceBlockFromCanonicalTex(canonicalResumeTex);

  const bundle = buildArtifactBundle({
    sanitized: snapshot.job,
    scoreResult: snapshot.scoreResult,
    judgeResult: snapshot.judgeResult,
    profile,
    canonical_resume_tex: canonicalResumeTex,
    experience_block: experienceBlock,
  });
  if (!bundle.ok) {
    manualLog(`failed bundle reason=${bundle.reason}`);
    return { ok: false, error: bundle.reason };
  }

  const coverLetterConfig: CoverLetterConfig = {
    model:       config.llm.cover_letter.model as string,
    max_tokens:  config.llm.cover_letter.max_tokens as number,
    temperature: config.llm.cover_letter.temperature as number,
    throttle_ms: (config.llm.cover_letter.throttle_ms ?? 1000) as number,
    review_queue_threshold: (config.llm.cover_letter.review_queue_threshold ?? 0.70) as number,
    retries:     (config.llm.cover_letter.retries ?? 1) as number,
    compile_pdf: (config.llm.cover_letter.compile_pdf ?? true) as boolean,
    ...(config.llm.cover_letter.thinking
      ? { thinking: config.llm.cover_letter.thinking as { type: "enabled"; budget_tokens: number } }
      : {}),
  };

  const resumeGeneratorConfig: ResumeGenConfig = {
    model: (config.llm.resume_generator?.model ?? config.llm.cover_letter.model) as string,
    fallback_model: config.llm.resume_generator?.fallback_model as string | undefined,
    max_tokens:  (config.llm.resume_generator?.max_tokens ?? 8000) as number,
    temperature: (config.llm.resume_generator?.temperature ?? 0.3) as number,
    throttle_ms: (config.llm.resume_generator?.throttle_ms ?? 1000) as number,
    compile_pdf: (config.llm.resume_generator?.compile_pdf ?? true) as boolean,
    review_queue_threshold: (config.llm.resume_generator?.review_queue_threshold ?? 0.70) as number,
    retries:     (config.llm.resume_generator?.retries ?? 1) as number,
    word_count_min: config.llm.resume_generator?.word_count_min as number | undefined,
    word_count_max: config.llm.resume_generator?.word_count_max as number | undefined,
  };

  const jobSlug = makeJobSlug(
    {
      title:     bundle.job.title,
      company:   bundle.job.company.name,
      posted_at: bundle.job.meta.posted_at,
    },
    jobId,
  );
  const runFolderName = makeManualFolderName(new Date());
  const runDir = path.join(repoRoot, "output", "applications", runFolderName);
  const jobFolderAbs = path.join(runDir, jobSlug);
  manualLog(`folder=${path.relative(repoRoot, jobFolderAbs)}`);
  manualLog(`models resume=${resumeGeneratorConfig.model} cover=${coverLetterConfig.model}`);

  const ctx = {
    runId:         snapshot.run_id,
    bucket:        snapshot.bucket,
    generatedBy:   "manual" as const,
  };

  writeJobDescription(bundle, jobFolderAbs);

  const [resumeOutcome, coverOutcome] = await Promise.all([
    generateAndSaveResume(bundle, resumeGeneratorConfig, repoRoot, jobFolderAbs, ctx),
    generateAndSaveCoverLetter(bundle, coverLetterConfig, repoRoot, jobFolderAbs, ctx),
  ]);
  manualLog(
    `resume tex=${resumeOutcome.tex_path ? "yes" : "no"} flags=${resumeOutcome.flags.join(",") || "(none)"} ` +
    `error=${String((resumeOutcome.meta as Record<string, unknown>).error ?? "")}`,
  );
  manualLog(
    `cover tex=${coverOutcome.tex_path ? "yes" : "no"} flags=${coverOutcome.flags.join(",") || "(none)"} ` +
    `error=${String((coverOutcome.meta as Record<string, unknown>).error ?? "")}`,
  );

  // --- Post-generation audit (risk map ledger) ---
  if (resumeOutcome.tex_path) {
    try {
      const resumeTex = fs.readFileSync(resumeOutcome.tex_path, "utf8");
      const { summary, ledger } = auditTailoredArtifact({
        tailoredText:  resumeTex,
        canonicalText: bundle.canonical_resume_tex,
        jobId,
        runId:         null,
        artifactType:  "resume",
      });
      (resumeOutcome.meta as Record<string, unknown>).risk_summary  = summary;
      applyResumeAttributionOverrunFlag(resumeOutcome.flags, summary);
      (resumeOutcome.meta as Record<string, unknown>).flags = resumeOutcome.flags;
      (resumeOutcome.meta as Record<string, unknown>).export_status = summary.human_review_items.length > 0 ? "needs_review" : "ok";
      await insertLedgerEntries(ledger);
    } catch (e) {
      console.warn(`[manual-generate] audit(resume) failed: ${e}`);
    }
  }

  if (coverOutcome.tex_path) {
    try {
      const coverTex = fs.readFileSync(coverOutcome.tex_path, "utf8");
      const { summary, ledger } = auditTailoredArtifact({
        tailoredText:  coverTex,
        canonicalText: bundle.canonical_resume_tex,
        jobId,
        runId:         null,
        artifactType:  "cover_letter",
      });
      (coverOutcome.meta as Record<string, unknown>).risk_summary  = summary;
      (coverOutcome.meta as Record<string, unknown>).export_status = summary.human_review_items.length > 0 ? "needs_review" : "ok";
      await insertLedgerEntries(ledger);
    } catch (e) {
      console.warn(`[manual-generate] audit(cover) failed: ${e}`);
    }
  }

  writeCombinedMeta(jobFolderAbs, repoRoot, bundle, resumeOutcome, coverOutcome, ctx);

  const metaRel = path.relative(repoRoot, path.join(jobFolderAbs, "meta.json"));

  let coverLetterPath: string | null = null;
  if (coverOutcome.tex_path) {
    coverLetterPath = coverOutcome.pdf_path
      ? path.relative(repoRoot, coverOutcome.pdf_path)
      : path.relative(repoRoot, coverOutcome.tex_path);
  }

  if (resumeOutcome.tex_path) {
    await insertTailoredResumeArtifact({
      job_id:          jobId,
      run_id:          snapshot.run_id,
      tex_path:        path.relative(repoRoot, resumeOutcome.tex_path),
      pdf_path:        resumeOutcome.pdf_path ? path.relative(repoRoot, resumeOutcome.pdf_path) : null,
      meta_path:       metaRel,
      word_count:      resumeOutcome.word_count,
      model:           String(resumeOutcome.meta.model ?? resumeGeneratorConfig.model),
      prompt_sha:      String(resumeOutcome.meta.prompt_sha ?? ""),
      canonical_sha:   String(resumeOutcome.meta.canonical_sha ?? ""),
      input_tokens:    (resumeOutcome.meta.input_tokens as number | null) ?? null,
      output_tokens:   (resumeOutcome.meta.output_tokens as number | null) ?? null,
      compile_status:  String(resumeOutcome.meta.compile_status ?? "failed"),
      generated_by:    "manual",
      flags:           resumeOutcome.flags,
    });
  }

  if (coverOutcome.tex_path) {
    await insertCoverLetterArtifact({
      job_id:          jobId,
      run_id:          snapshot.run_id,
      content:         null,
      file_path:       coverLetterPath,
      tex_path:        path.relative(repoRoot, coverOutcome.tex_path),
      pdf_path:        coverOutcome.pdf_path ? path.relative(repoRoot, coverOutcome.pdf_path) : null,
      meta_path:       metaRel,
      word_count:      coverOutcome.word_count,
      model:           String(coverOutcome.meta.model ?? coverLetterConfig.model),
      prompt_sha:      String(coverOutcome.meta.prompt_sha ?? ""),
      canonical_sha:   String(coverOutcome.meta.canonical_sha ?? ""),
      input_tokens:    (coverOutcome.meta.input_tokens as number | null) ?? null,
      output_tokens:   (coverOutcome.meta.output_tokens as number | null) ?? null,
      compile_status:  String(coverOutcome.meta.compile_status ?? "failed"),
      generated_by:    "manual",
      flags:           coverOutcome.flags,
    });
  }

  return {
    ok: true,
    resume: resumeOutcome.meta,
    cover:  coverOutcome.meta,
  };
}

function createManualGenerationLog(repoRoot: string, jobId: string): (msg: string) => void {
  const dir = path.resolve(process.env.OUTPUT_DIR ?? path.join(repoRoot, "output"), "logs", "runs");
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const safeJobId = jobId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24) || "unknown";
  const logPath = path.join(dir, `manual_${ts}_${safeJobId}.log`);

  return (msg: string) => {
    const line = `[manual-generate] ${new Date().toISOString()} ${msg}\n`;
    try {
      fs.appendFileSync(logPath, line, "utf8");
    } catch {
      // Logging is diagnostic only; never break artifact generation.
    }
  };
}
