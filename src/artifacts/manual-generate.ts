/**
 * manual-generate.ts — Manual artifact generation entrypoint for UI and API flows.
 *
 * Builds same resume and cover-letter artifacts as pipeline runs, but for an
 * operator-triggered single job using latest persisted job snapshot and local config.
 *
 * Called by: UI/API manual generation endpoints and scripts
 * Side effects: reads config/profile/canonical resume, writes artifacts/logs/meta, hits LLMs, inserts DB rows
 */

import * as fs   from "fs";
import * as path from "path";
import { config as loadEnv } from "dotenv";

import { validateProfile } from "@/filter/validate";
import { generateAndSaveCoverLetter } from "@/cover-letter/saver";
import type { CoverLetterConfig } from "@/cover-letter/types";
import { loadCanonicalResumeMaster } from "@/cover-letter/resume";
import { buildExperienceBlockFromCanonicalTex } from "@/cover-letter/resume-brief";
import { generateAndSaveResume } from "@/resume-generator/index";
import type { ResumeGenConfig } from "@/resume-generator/types";
import { extractRoleLabels } from "@/resume-generator/patch/parser";
import { judge } from "@/judge/judge";
import type { JudgeConfig } from "@/judge/judge";
import { getBucket } from "@/judge/judge";
import { extractRolesFromCanonicalTex, extractSkillsSectionFromCanonical } from "@/judge/roles-extractor";
import { buildArtifactBundle } from "@/shared/artifact-bundle";
import { makeJobSlug } from "@/shared/slug";
import { makeDateFolderName, makeManualFolderName } from "@/applications/run-folder";
import { fetchLatestJobSnapshotForArtifacts } from "@/storage/artifact-load";
import {
  insertCoverLetterArtifact,
  insertTailoredResumeArtifact,
  insertLedgerEntries,
  detectRegenerationReason,
  upsertJudgeVerdict,
} from "@/storage/persist";
import { writeJobDescription } from "@/applications/job-description-writer";
import { writeCombinedMeta } from "@/applications/combined-meta";
import { findCachedResumeOutcome } from "@/artifacts/resume-cache";
import { auditTailoredArtifact, applyResumeAttributionOverrunFlag, isRiskMapLoaded, loadRiskMap } from "@/risk-map";
import { runEvals } from "@/evals/runner";

export interface ManualGenerateResult {
  /** Whether manual generation finished without fatal preflight or persistence errors. */
  ok: boolean;
  /** True when force was false and rows already exist (HTTP 409). */
  conflict?: boolean;
  /** Human-readable failure reason for UI/API callers. */
  error?: string;
  /** Resume artifact metadata returned to callers when generation reached resume stage. */
  resume?: Record<string, unknown> | null;
  /** Cover-letter artifact metadata returned to callers when generation reached cover stage. */
  cover?:  Record<string, unknown> | null;
}

/**
 * Generates resume and cover-letter artifacts for one job outside scheduled pipeline runs.
 *
 * This path deliberately reuses pipeline builders, validators, persistence, and
 * risk auditing so manual generation does not drift from production artifact rules.
 *
 * @param repoRoot - Repository root containing config, output, and canonical resume files.
 * @param jobId - Persisted job identifier whose latest scored snapshot should be rendered.
 * @param options - Manual-run controls such as forcing regeneration instead of cache reuse.
 * @returns Outcome payload for UI/API callers with artifact metadata or failure reason.
 * @throws {Error} Propagates unexpected filesystem, database, or generator errors not handled as user-facing failures.
 */
export async function manualGenerateArtifacts(
  repoRoot: string,
  jobId: string,
  options?: { force?: boolean; regeneration_reason?: string },
): Promise<ManualGenerateResult> {
  loadEnv({ path: path.join(repoRoot, ".env") });
  const generatedAt = new Date();
  const runFolderName = makeManualFolderName(generatedAt);
  const manualLog = createManualGenerationLog(repoRoot, jobId, runFolderName, generatedAt);
  manualLog(`start job_id=${jobId} force=${String(options?.force)}`);

  // Detect why this generation is being triggered (first-run vs. regeneration).
  // Caller may supply an explicit reason; otherwise auto-detect from previous DB rows.
  const regenerationReason: string | null = options?.force
    ? (options.regeneration_reason ?? await detectRegenerationReason(jobId))
    : null;

  if (!isRiskMapLoaded()) {
    loadRiskMap(repoRoot);
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

  // When force=true, re-run the judge with the current prompt before generating
  // artifacts so changes to the judge prompt (e.g. fabricate vs reframe logic)
  // take effect immediately without requiring a full pipeline re-run.
  let activeJudgeResult = snapshot.judgeResult;
  if (options?.force === true) {
    manualLog("rejudge start");
    try {
      const judgeConfig: JudgeConfig = {
        model:       (config.llm.judge?.model ?? config.llm.cover_letter.model) as string,
        max_tokens:  (config.llm.judge?.max_tokens ?? 3000) as number,
        temperature: (config.llm.judge?.temperature ?? 0.2) as number,
        throttle_ms: (config.llm.judge?.throttle_ms ?? 0) as number,
        ...(config.llm.judge?.reasoning ? { reasoning: config.llm.judge.reasoning as import("@/judge/client").ReasoningConfig } : {}),
      };
      const rolesList    = extractRolesFromCanonicalTex(canonicalResumeTex);
      const canonicalSkills = extractSkillsSectionFromCanonical(path.join(repoRoot, "config", "resume_master.tex"));
      const allowedLabels   = extractRoleLabels(canonicalResumeTex);
      const freshJudge = await judge(
        {
          job:   {
            title:              snapshot.job.title,
            company:            snapshot.job.company.name,
            employment_type:    snapshot.job.employment_type ?? null,
            seniority:          snapshot.job.seniority ?? null,
            domain:             snapshot.job.domain ?? null,
            required_skills:    snapshot.job.required_skills,
            years_experience:   snapshot.job.years_experience,
            education_required: snapshot.job.education_required,
            visa_sponsorship:   snapshot.job.visa_sponsorship,
            visa_quote:         snapshot.job.visa_quote ?? null,
            responsibilities:   snapshot.job.responsibilities,
            flags:              snapshot.job.meta.flags,
          },
          score: {
            total:      snapshot.scoreResult.score,
            components: snapshot.scoreResult.components,
          },
          run_id:              snapshot.run_id,
          job_id:              jobId,
          profile,
          roles_list:          rolesList   || undefined,
          canonical_skills:    canonicalSkills || undefined,
          allowed_role_labels: allowedLabels.length > 0 ? allowedLabels : undefined,
        },
        judgeConfig,
      );
      if (freshJudge.status === "ok" && freshJudge.verdict) {
        const newBucket = getBucket(freshJudge, snapshot.scoreResult.score);
        await upsertJudgeVerdict(jobId, snapshot.run_id, freshJudge, newBucket);
        activeJudgeResult = freshJudge;
        manualLog(`rejudge ok verdict=${freshJudge.verdict} bucket=${newBucket}`);
      } else {
        manualLog(`rejudge failed — using cached verdict. error=${freshJudge.error ?? "unknown"}`);
      }
    } catch (e) {
      manualLog(`rejudge threw — using cached verdict. error=${String(e).slice(0, 200)}`);
    }
  }

  const bundle = buildArtifactBundle({
    sanitized: snapshot.job,
    scoreResult: snapshot.scoreResult,
    judgeResult: activeJudgeResult,
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
    mode: (config.llm.resume_generator?.mode ?? "patch_tailoring") as ResumeGenConfig["mode"],
  };

  const jobSlug = makeJobSlug(
    {
      title:     bundle.job.title,
      company:   bundle.job.company.name,
      posted_at: bundle.job.meta.posted_at,
    },
    jobId,
  );
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

  const cachedResumeOutcome = options?.force === true
    ? null
    : await findCachedResumeOutcome(repoRoot, bundle, resumeGeneratorConfig);
  if (cachedResumeOutcome) {
    manualLog(`resume cache_hit tex=${cachedResumeOutcome.tex_path}`);
  }

  const [resumeOutcome, coverOutcome] = await Promise.all([
    cachedResumeOutcome ?? generateAndSaveResume(bundle, resumeGeneratorConfig, repoRoot, jobFolderAbs, ctx),
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

  let evals = null;
  try {
    const patchOps = (resumeOutcome.meta.patch_ops as unknown[]) ?? [];
    evals = runEvals({
      canonicalTex:    bundle.canonical_resume_tex,
      judgeJson:       bundle.judge_json as Parameters<typeof runEvals>[0]["judgeJson"],
      patchOps:        patchOps as Parameters<typeof runEvals>[0]["patchOps"],
      resumeFlags:     resumeOutcome.flags,
      patchPromptSha:  (resumeOutcome.meta.patch_prompt_sha as string | null) ?? null,
      coverLetterText: coverOutcome.tex_path ? null : null,
      coverFlags:      coverOutcome.flags,
      coverWordCount:  coverOutcome.word_count,
      coverPromptSha:  (coverOutcome.meta?.prompt_sha as string | null) ?? null,
    });
  } catch (e) {
    console.warn(`[manual-generate] evals failed: ${e}`);
  }

  writeCombinedMeta(jobFolderAbs, repoRoot, bundle, resumeOutcome, coverOutcome, ctx, evals, regenerationReason);

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
      compile_status:       String(resumeOutcome.meta.compile_status ?? "failed"),
      generated_by:         String(resumeOutcome.meta.generated_by ?? "manual"),
      flags:                resumeOutcome.flags,
      regeneration_reason:  regenerationReason,
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
      compile_status:       String(coverOutcome.meta.compile_status ?? "failed"),
      generated_by:         "manual",
      flags:                coverOutcome.flags,
      regeneration_reason:  regenerationReason,
    });
  }

  return {
    ok: true,
    resume: resumeOutcome.meta,
    cover:  coverOutcome.meta,
  };
}

/**
 * Creates append-only diagnostic logger for one manual generation run.
 *
 * Logging must never block artifact generation, so write failures are swallowed
 * after path sanitization and directory creation.
 *
 * @param repoRoot - Repository root used when `OUTPUT_DIR` is not set.
 * @param jobId - Job identifier incorporated into log filename for traceability.
 * @param runFolderName - Manual run folder name mirrored in artifact output layout.
 * @param generatedAt - Timestamp that pins both folder and log file naming.
 * @returns Function that appends timestamped diagnostic lines to run log.
 */
function createManualGenerationLog(
  repoRoot: string,
  jobId: string,
  runFolderName: string,
  generatedAt: Date,
): (msg: string) => void {
  const baseDir = path.resolve(process.env.OUTPUT_DIR ?? path.join(repoRoot, "output"), "logs", "runs");
  const dayDir = path.join(baseDir, makeDateFolderName(generatedAt));
  fs.mkdirSync(dayDir, { recursive: true });
  const ts = generatedAt.toISOString().replace(/[:.]/g, "-");
  const safeJobId = jobId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24) || "unknown";
  const safeRunFolder = runFolderName.replace(/[\\/]/g, "__").replace(/[^a-zA-Z0-9_-]/g, "_");
  const logPath = path.join(dayDir, `manual_${ts}_${safeRunFolder}_${safeJobId}.log`);

  return (msg: string) => {
    const line = `[manual-generate] ${new Date().toISOString()} ${msg}\n`;
    try {
      fs.appendFileSync(logPath, line, "utf8");
    } catch {
      // Logging is diagnostic only; never break artifact generation.
    }
  };
}
