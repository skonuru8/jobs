/**
 * run-pipeline.ts — Milestone 6 end-to-end pipeline.
 *
 * Runs full scrape-to-artifacts pipeline for a single source, including
 * filtering, extraction, scoring, judging, artifact generation, dedup, and
 * persistence. This is orchestration entrypoint for unattended pipeline runs
 * and manual local runs from repo root.
 *
 * Called by: `npx tsx scripts/run-pipeline.ts`, cron/manual shell wrappers
 * Writes to: `scraper/output/*.jsonl`, `output/applications/**`, `output/logs/runs/**`
 * Side effects: scraper subprocess spawn, LLM/API calls, Redis/Postgres I/O, filesystem writes
 */

import { spawnSync }     from "child_process";
import * as fs           from "fs";
import * as path         from "path";
import { fileURLToPath } from "url";
import { randomUUID }    from "crypto";
import { config as loadEnv } from "dotenv";
import pLimit            from "p-limit";

import { hardFilter }      from "@/filter/filter";
import { postFetchChecks } from "@/filter/post-fetch";
import { sanitizeJob }     from "@/filter/sanitize";
import { validateProfile } from "@/filter/validate";
import { normalizeSkill } from "@/filter/skills";
import { buildAliasMap } from "@/filter/config-loader";

import { fetchJobPage }  from "@/fetcher/fetch";
import { extract }       from "@/extractor/extract";
import { scoreJob }      from "@/scorer/score";
import { embedJob, embedProfile } from "@/scorer/embed";
import type { ScoringWeights, ScoreResult } from "@/scorer/types";

import { judge, getBucket } from "@/judge/judge";
import type { JudgeInput, JudgeResult, FinalBucket } from "@/judge/types";

import { generateAndSaveCoverLetter } from "@/cover-letter/saver";
import { loadCanonicalResumeMaster, loadResume } from "@/cover-letter/resume";
import type { CoverLetterConfig } from "@/cover-letter/types";
import type { Profile } from "@/filter/types";

import { generateAndSaveResume } from "@/resume-generator/index";
import type { ResumeGenConfig } from "@/resume-generator/types";

import { buildExperienceBlockFromCanonicalTex } from "@/cover-letter/resume-brief";
import { extractRolesFromCanonicalResume, extractSkillsSectionFromCanonical } from "@/judge/roles-extractor";
import { extractRoleLabels } from "@/resume-generator/patch/parser";
import { writeJobDescription } from "@/applications/job-description-writer";
import { writeCombinedMeta } from "@/applications/combined-meta";
import { runEvals } from "@/evals/runner";
import { writeBatchReport } from "@/evals/batch-report";
import { findCachedResumeOutcome } from "@/artifacts/resume-cache";
import { makeDateFolderName, makeRunFolderName, makeRunLabel } from "@/applications/run-folder";
import { buildArtifactBundle } from "@/shared/artifact-bundle";
import { makeJobSlug } from "@/shared/slug";
import { loadRiskMap, auditTailoredArtifact, applyResumeAttributionOverrunFlag } from "@/risk-map";
import { parseBoolEnv } from "@/pipeline/env";
import { routeJob, hasUsableDescription } from "@/pipeline/routing";

// Dedup + storage — gracefully disabled via SKIP_DEDUP=1 / SKIP_PERSIST=1
import {
  connectRedis, disconnectRedis, isSeen, markSeen, listSeenJobIds,
  findSemanticDuplicate,
} from "@/dedup/index";
import {
  runMigrations, saveRun, finishRun, saveJob, closePool,
  insertTailoredResumeArtifact, insertCoverLetterArtifact,
  insertLedgerEntries, markStorageDisabled, formatErr, verifyIntegrity, formatReport as formatIntegrityReport,
} from "@/storage/index";
import type { JobRecord } from "@/storage/types";


// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename       = fileURLToPath(import.meta.url);
const __dirname_compat = path.dirname(__filename);

const REPO_ROOT      = path.resolve(__dirname_compat, "..");
const SCRAPER_OUT_DIR = path.join(REPO_ROOT, "scraper", "output");
const PROFILE_PATH    = path.join(REPO_ROOT, "config", "profile.json");
const SKILLS_PATH     = path.join(REPO_ROOT, "config", "skills.json");
const CONFIG_PATH     = path.join(REPO_ROOT, "config", "config.json");

// Load .env from project root (dotenv/config searches cwd which may differ)
loadEnv({ path: path.join(REPO_ROOT, ".env") });

// ---------------------------------------------------------------------------
// Config from env
// ---------------------------------------------------------------------------

const SOURCE         = process.env.SOURCE  ?? "dice";
const MAX_JOBS       = parseInt(process.env.MAX ?? "20", 10);
// "Target N new" mode (Option A). When > 0, MAX is the scrape POOL and only the
// first TARGET_NEW post-dedup survivors are fully processed + marked seen; the
// rest of the pool is left untouched so the next run walks further down the list.
const TARGET_NEW     = parseInt(process.env.TARGET_NEW ?? "0", 10);
const HEADED         = parseBoolEnv(process.env.HEADED);
const JSONL_OVERRIDE = process.env.JSONL   ?? "";
const DO_EXTRACT     = parseBoolEnv(process.env.EXTRACT);   // opt-in — costs LLM calls
const DO_SCORE       = DO_EXTRACT || parseBoolEnv(process.env.SCORE);  // auto when extract runs
const DO_JUDGE       = DO_EXTRACT || parseBoolEnv(process.env.JUDGE);  // auto when extract runs
const DO_COVER       = DO_EXTRACT || parseBoolEnv(process.env.COVER);  // auto when extract runs
/** When false, skip tailored resume LLM+PDF (default: enabled). */
const DO_RESUME_ARTIFACT = parseBoolEnv(process.env.DO_RESUME, true);
/** When false (default), skip cover letter LLM+PDF in pipeline. Cover letters are generated from the UI on demand. Opt in with DO_COVER=true. */
const DO_COVER_ARTIFACT = parseBoolEnv(process.env.DO_COVER, false);
const SAVE_FIXTURES  = parseBoolEnv(process.env.SAVE_FIXTURES); // save real extraction fixtures
const SKIP_DEDUP     = parseBoolEnv(process.env.SKIP_DEDUP);    // bypass Redis + pgvector dedup
const SKIP_PERSIST   = parseBoolEnv(process.env.SKIP_PERSIST);  // bypass Postgres persistence
const VERIFY         = parseBoolEnv(process.env.VERIFY);        // run Redis↔Postgres integrity check

// Dice-only env vars. Both passed through to the scraper subprocess.
//   QUERY=<term>                    search term (default: config scraping.dice.query)
//   POSTED_WITHIN=ONE|THREE|SEVEN   server-side recency filter:
//                                     ONE   = jobs posted in last 24h
//                                     THREE = jobs posted in last 3 days
//                                     SEVEN = jobs posted in last 7 days
//                                     unset = no filter (all listings)
// Use POSTED_WITHIN=ONE for cron runs to only pull genuinely new jobs.
const POSTED_WITHIN  = process.env.POSTED_WITHIN ?? "";   // "" = no filter

// LinkedIn-only recency filter (JobSpy hours_old), passed through to the scraper.
//   HOURS_OLD=<int>   only include LinkedIn jobs posted within this many hours
//                     unset = use config scraping.linkedin.hours_old default
const HOURS_OLD      = process.env.HOURS_OLD ?? "";       // "" = use config default

// Real-data extraction fixtures live alongside the existing extractor fixtures.
// This keeps tests + captured samples in one place and avoids a separate
// top-level `extractor/fixtures/` directory.
const FIXTURES_DIR   = path.join(REPO_ROOT, "fixtures", "extractor");
const CONFIG_DIR     = path.join(REPO_ROOT, "config");
const RUN_ID = process.env.RUN_ID ?? randomUUID();
const RUN_STARTED_AT = new Date();
const RUN_FOLDER_NAME = makeRunFolderName(RUN_STARTED_AT, RUN_ID);
const RUN_LOG_PATH = installRunLog(REPO_ROOT, SOURCE, RUN_ID, RUN_STARTED_AT);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Loads runtime config, prepares shared context, and executes full pipeline run.
 *
 * Keeps startup validation separate from per-job processing so fatal config or
 * infrastructure issues fail fast before any scraper, LLM, or persistence work
 * begins. Also owns run-level teardown for dedup and storage connections.
 *
 * @returns Promise that resolves after pipeline summary, persistence, and cleanup complete.
 * @throws Exits process via `die()` for missing required config or runtime prerequisites.
 */
async function main(): Promise<void> {
  if (RUN_LOG_PATH) {
    log(`Run log: ${RUN_LOG_PATH}`);
  }

  // --- Load profile ---
  if (!fs.existsSync(PROFILE_PATH)) {
    die(`Profile not found at ${PROFILE_PATH}\n  cp config/profile-v2.json config/profile.json`);
  }
  const profile = JSON.parse(fs.readFileSync(PROFILE_PATH, "utf-8"));
  try { validateProfile(profile); } catch (err) { die(`Profile validation failed: ${err}`); }
  log(`Profile: ${profile.meta?.profile_id ?? "unknown"}`);

  // --- Load config ---
  if (!fs.existsSync(CONFIG_PATH)) {
    die(`Config not found at ${CONFIG_PATH}`);
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  const QUERY = process.env.QUERY ?? (config.scraping?.dice?.query as string | undefined) ?? "java developer";
  const extractorConfig = {
    model:       config.llm.extractor.model       as string,
    max_tokens:  config.llm.extractor.max_tokens  as number,
    temperature: config.llm.extractor.temperature as number,
    throttle_ms: (config.llm.extractor.throttle_ms ?? 0) as number,
    ...(config.llm.extractor.reasoning
      ? { reasoning: config.llm.extractor.reasoning as Record<string, unknown> }
      : {}),
  };
  const judgeConfig = {
    model:       config.llm.judge.model       as string,
    max_tokens:  config.llm.judge.max_tokens  as number,
    temperature: config.llm.judge.temperature as number,
    throttle_ms: (config.llm.judge.throttle_ms ?? 600) as number,
    ...(config.llm.judge.reasoning
      ? { reasoning: config.llm.judge.reasoning as Record<string, unknown> }
      : {}),
  };
  const coverLetterConfig: CoverLetterConfig = {
    model:       config.llm.cover_letter.model       as string,
    max_tokens:  config.llm.cover_letter.max_tokens  as number,
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
    patch_max_tokens: config.llm.resume_generator?.patch_max_tokens as number | undefined,
    temperature: (config.llm.resume_generator?.temperature ?? 0.3) as number,
    throttle_ms: (config.llm.resume_generator?.throttle_ms ?? 1000) as number,
    compile_pdf: (config.llm.resume_generator?.compile_pdf ?? true) as boolean,
    review_queue_threshold: (config.llm.resume_generator?.review_queue_threshold ?? 0.70) as number,
    patch_ops_warn_threshold: config.llm.resume_generator?.patch_ops_warn_threshold as number | undefined,
    retries:     (config.llm.resume_generator?.retries ?? 1) as number,
    word_count_min: config.llm.resume_generator?.word_count_min as number | undefined,
    word_count_max: config.llm.resume_generator?.word_count_max as number | undefined,
    mode: (config.llm.resume_generator?.mode ?? "patch_tailoring") as ResumeGenConfig["mode"],
  };
  const scoringWeights: ScoringWeights = config.scoring?.weights ?? {
    skills: 0.35, semantic: 0.25, yoe: 0.15, seniority: 0.15, location: 0.10,
  };
  const scoringThreshold: number = config.scoring?.gate_threshold ?? 0.55;

  // --- Load tech equivalence risk map ---
  loadRiskMap(REPO_ROOT);
  log(`[init] risk map loaded`);

  // --- Load skill aliases ---
  if (!fs.existsSync(SKILLS_PATH)) {
    die(`Skills not found at ${SKILLS_PATH}`);
  }
  const skillsJson = JSON.parse(fs.readFileSync(SKILLS_PATH, "utf-8"));
  const aliases    = buildAliasMap(skillsJson);
  log(`Skill aliases loaded: ${Object.keys(aliases).length} entries`);

  // --- Canonical resume (required when resume/cover artifacts run) ---
  let canonicalResumeTex: string | null = null;
  if (DO_EXTRACT && (DO_RESUME_ARTIFACT || DO_COVER_ARTIFACT)) {
    canonicalResumeTex = loadCanonicalResumeMaster(REPO_ROOT);
    if (!canonicalResumeTex) {
      die(`Missing config/resume_master.tex (required when EXTRACT=1 and resume/cover artifacts are enabled).`);
    }
    log(`Canonical resume loaded (${canonicalResumeTex.length} chars)`);
  }

  // --- Plain resume text (optional, for logging / legacy) ---
  const resumeText = loadResume(CONFIG_DIR);
  if (resumeText && !canonicalResumeTex) {
    log(`Resume text loaded (${resumeText.length} chars) — add config/resume_master.tex for full LaTeX tailoring`);
  } else if (!resumeText && !canonicalResumeTex) {
    log(`No resume text found in config/ — artifact generation requires resume_master.tex when enabled`);
  }

  if (DO_EXTRACT) {
    if (!process.env.OPENROUTER_API_KEY) {
      die("EXTRACT=1 set but OPENROUTER_API_KEY not found.\nAdd it to .env or export it.");
    }
    log(`Extraction enabled  — model: ${extractorConfig.model}`);
    log(`Judge enabled       — model: ${judgeConfig.model}`);
    log(`Cover letter enabled— model: ${coverLetterConfig.model}`);
  } else {
    log("Extraction disabled (set EXTRACT=1 to enable)");
    log("Judge/Cover letter disabled (auto-enabled with EXTRACT=1)");
  }

  // --- Storage + dedup init (non-fatal — pipeline continues if unavailable) ---
  if (!SKIP_DEDUP) {
    await connectRedis();
  } else {
    log("Dedup disabled (SKIP_DEDUP=1)");
  }
  if (!SKIP_PERSIST) {
    try {
      await runMigrations();
      await saveRun({ run_id: RUN_ID, source: SOURCE, started_at: new Date().toISOString() });
      log(`Run record saved: ${RUN_ID}`);
    } catch (e: any) {
      log(`Storage init failed (continuing without persistence): ${e.message}`);
      markStorageDisabled(formatErr(e));
    }
  } else {
    log("Persistence disabled (SKIP_PERSIST=1)");
  }

  // --- Profile embedding (once at startup, reused for all jobs) ---
  let profileEmbedding: Float32Array | null = null;
  if (DO_SCORE) {
    log("Scoring enabled — embedding profile...");
    try {
      profileEmbedding = await embedProfile(profile);
      log(`Profile embedded (${profileEmbedding.length}-dim)`);
    } catch (e) {
      log(`Profile embedding failed (scoring will skip semantic component): ${e}`);
    }
  } else {
    log("Scoring disabled (auto-enabled with EXTRACT=1, or set SCORE=1)");
  }

  // --- Scrape or use existing JSONL ---
  const jsonlPath = JSONL_OVERRIDE
  ? JSONL_OVERRIDE
  : runScraper(SOURCE, MAX_JOBS, HEADED, QUERY, POSTED_WITHIN, HOURS_OLD);

  if (!fs.existsSync(jsonlPath)) die(`JSONL not found: ${jsonlPath}`);
  log(`Reading: ${jsonlPath}`);

  // --- Process ---
  const nowIso  = RUN_STARTED_AT.toISOString();
  const runFolderName = RUN_FOLDER_NAME;
  const experienceBlock = canonicalResumeTex
    ? buildExperienceBlockFromCanonicalTex(canonicalResumeTex)
    : "";
  const canonicalTexPath = path.join(REPO_ROOT, "config", "resume_master.tex");
  const rolesList = canonicalResumeTex
    ? extractRolesFromCanonicalResume(canonicalTexPath)
    : "";
  const canonicalSkillsText = canonicalResumeTex
    ? extractSkillsSectionFromCanonical(canonicalTexPath)
    : "";

  let ranFinishRun = false;
  try {
    const results = await processJobs(
      jsonlPath, profile, aliases,
      extractorConfig, judgeConfig, coverLetterConfig, resumeGeneratorConfig,
      scoringWeights, scoringThreshold,
      profileEmbedding, resumeText, canonicalResumeTex, experienceBlock, rolesList, canonicalSkillsText, nowIso,
      REPO_ROOT, RUN_ID, runFolderName, DO_RESUME_ARTIFACT, DO_COVER_ARTIFACT,
    );

    let artifactIn = 0;
    let artifactOut = 0;
    for (const r of results) {
      artifactIn += r.artifact_input_tokens ?? 0;
      artifactOut += r.artifact_output_tokens ?? 0;
    }
    if (artifactIn + artifactOut > 0) {
      log(`Artifact LLM tokens (resume+cover this run): input=${artifactIn} output=${artifactOut} total=${artifactIn + artifactOut}`);
    }

    printResults(results, SOURCE, scoringThreshold);

    // --- Save results to disk (JSONL — always written when EXTRACT=1) ---
    if (DO_EXTRACT) {
      const outPath = path.join(SCRAPER_OUT_DIR, `results_${SOURCE}_${RUN_ID}.jsonl`);
      const lines = results.map(r => JSON.stringify(r)).join("\n");
      fs.writeFileSync(outPath, lines + "\n", "utf-8");
      log(`Results saved: ${outPath}`);
    }

    if (!SKIP_PERSIST) {
      const runDir = path.join(REPO_ROOT, "output", "applications", runFolderName);
      if (fs.existsSync(runDir)) {
        try {
          writeBatchReport(runDir, REPO_ROOT);
        } catch (e) {
          log(`[evals] batch report failed: ${e}`);
        }
      }
    }

    // --- Finish run record in Postgres ---
    if (!SKIP_PERSIST) {
      await finishRun(RUN_ID, {
        finished_at:  new Date().toISOString(),
        jobs_total:   results.length,
        jobs_passed:  results.filter(r => r.verdict !== "REJECT" && r.verdict !== "DEDUP").length,
        jobs_gated:   results.filter(r => r.verdict === "GATE_PASS").length,
        jobs_covered: results.filter(r => r.cover_letter_path != null || r.resume_pdf_path != null).length,
        extractions_attempted: results.filter(r => r.extract_status === "ok" || r.extract_status === "error").length,
        extractions_succeeded: results.filter(r => r.extract_status === "ok").length,
        exit_code:    0,
      });
    }
    ranFinishRun = true;

    if (VERIFY && !SKIP_DEDUP && !SKIP_PERSIST) {
      const seenIds = await listSeenJobIds(SOURCE);
      const report = await verifyIntegrity(SOURCE, seenIds);
      log(formatIntegrityReport(report));
    }
  } catch (e) {
    // Only write the failure record when processJobs itself failed — not when
    // disconnectRedis/closePool fail after a successful run (those are in finally).
    if (!SKIP_PERSIST && !ranFinishRun) {
      await finishRun(RUN_ID, {
        finished_at: new Date().toISOString(),
        jobs_total: 0,
        jobs_passed: 0,
        jobs_gated: 0,
        jobs_covered: 0,
        extractions_attempted: 0,
        extractions_succeeded: 0,
        exit_code: 1,
      });
    }
    throw e;
  } finally {
    // Teardown runs regardless of success/failure; errors here are swallowed
    // so they don't mask or overwrite a real processing error.
    if (!SKIP_DEDUP)   await disconnectRedis().catch(() => {});
    if (!SKIP_PERSIST) await closePool().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Scraper spawn
// ---------------------------------------------------------------------------

/**
 * Runs scraper CLI for requested source and returns freshest JSONL output path.
 *
 * Centralizes subprocess argument wiring so pipeline and scraper CLI stay in
 * lockstep about source-specific options such as Dice search filters.
 *
 * @param source - Scraper source key such as `dice` or `linkedin`.
 * @param maxJobs - Maximum number of listings scraper should emit.
 * @param headed - Whether Playwright-backed sources should show browser UI.
 * @param query - Dice search query text. Ignored for non-Dice sources.
 * @param postedWithin - Optional Dice recency window passed through verbatim.
 * @param hoursOld - Optional LinkedIn recency window in hours (JobSpy hours_old).
 * @returns Absolute path to newest source JSONL file under `scraper/output`.
 * @throws Exits process via `die()` when scraper fails or no JSONL is produced.
 */
function runScraper(
  source:        string,
  maxJobs:       number,
  headed:        boolean,
  query:         string,
  postedWithin:  string,
  hoursOld:      string,
): string {
  const args = [
    "-m", "scraper",
    "--source", source,
    "--max",    String(maxJobs),
    ...(headed ? ["--headed"] : []),
  ];

  // Dice-only flags. Other sources ignore them (cli.py only passes them to dice).
  if (source === "dice") {
    args.push("--query", query);
    if (postedWithin) {
      args.push("--posted-within", postedWithin);
    }
  }

  // LinkedIn-only recency filter (JobSpy hours_old). Omitted = config default.
  if (source === "linkedin" && hoursOld) {
    args.push("--hours-old", hoursOld);
  }
 
  log(`Spawning: python ${args.join(" ")}`);
 
  const result = spawnSync("python", args, {
    cwd: REPO_ROOT, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"],
  });
 
  if (result.stderr) process.stderr.write(result.stderr);
 
  if (result.status === 2) die(`Cookie file missing — config/cookies/${source}.json`);
  if (result.status !== 0) die(`Scraper exited with code ${result.status}`);
 
  const jsonlPath = findNewestJsonl(source);
  if (!jsonlPath) die(`No JSONL in ${SCRAPER_OUT_DIR} for source "${source}"`);
  return jsonlPath!;
}


/**
 * Finds newest scraper JSONL for source by file modification time.
 *
 * @param source - Scraper source prefix used in JSONL filenames.
 * @returns Absolute JSONL path when at least one matching file exists; otherwise `null`.
 */
function findNewestJsonl(source: string): string | null {
  if (!fs.existsSync(SCRAPER_OUT_DIR)) return null;
  const files = fs
    .readdirSync(SCRAPER_OUT_DIR)
    .filter(f => f.startsWith(`${source}_`) && f.endsWith(".jsonl"))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(SCRAPER_OUT_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files.length ? path.join(SCRAPER_OUT_DIR, files[0].name) : null;
}

// ---------------------------------------------------------------------------
// Job processing — full pipeline
// ---------------------------------------------------------------------------

interface JobResult {
  title:         string;
  company:       string;
  source_url?:   string | null;
  verdict:       string;   // REJECT | PASS | GATE_PASS | ARCHIVE
  reason:        string | null;
  flags:         string[];
  // Populated after extraction (only for PASS + EXTRACT=1)
  skills?:       string[];
  yoe_min?:      number | null;
  yoe_max?:      number | null;
  domain?:       string | null;
  fetch_status?: string;
  extract_status?: string;
  // Populated after scoring (only when SCORE=1 or EXTRACT=1)
  score?:        ScoreResult;
  // Populated after judge (Stage 13-14, only for GATE_PASS when JUDGE=1)
  judge_verdict?:   string | null;
  judge_reasoning?: string | null;
  judge_concerns?:  string[];
  bucket?:          FinalBucket;
  // Populated after cover letter (Stage 15)
  cover_letter_path?: string | null;
  cover_letter_words?: number | null;
  resume_pdf_path?: string | null;
  /** Sum of LLM input+output tokens for resume+cover when generated this run. */
  artifact_input_tokens?:   number;
  artifact_output_tokens?:  number;
  /** Judge LLM token spend for this job. */
  judge_input_tokens?:      number;
  judge_output_tokens?:     number;
  /** Extractor LLM token spend for this job. */
  extractor_input_tokens?:  number;
  extractor_output_tokens?: number;
}

/**
 * Processes one JSONL scrape artifact through full post-scrape pipeline.
 *
 * Preserves original input order while still running expensive fetch/extract/
 * judge/artifact work concurrently. Splits work into reject, dedup, and pass
 * lanes so cheap eliminations happen before any LLM or persistence cost.
 *
 * @param jsonlPath - Absolute path to scraper output file for this run.
 * @param profile - Validated candidate profile used by filters, scoring, and judge.
 * @param aliases - Skill alias map for extractor normalization.
 * @param extractorConfig - LLM extractor runtime settings.
 * @param judgeConfigArg - LLM judge runtime settings.
 * @param coverLetterConfigArg - Cover-letter generation settings.
 * @param resumeGeneratorConfigArg - Tailored resume generation settings.
 * @param scoringWeights - Weight vector for deterministic score components.
 * @param scoringThreshold - Minimum total score required to reach judge stage.
 * @param profileEmbedding - Precomputed candidate embedding reused across jobs.
 * @param resumeText - Optional plain-text resume fallback for legacy flows.
 * @param canonicalResumeTex - Canonical LaTeX source required for artifact generation.
 * @param experienceBlock - Pre-extracted experience summary used in artifact prompts.
 * @param rolesList - Canonical roles summary supplied to judge prompt.
 * @param canonicalSkillsText - Canonical skills section supplied to judge prompt.
 * @param nowIso - Run timestamp used by post-fetch checks.
 * @param repoRoot - Repository root for resolving outputs and cache paths.
 * @param runIdForArtifacts - Run identifier stored in generated artifact metadata.
 * @param runFolderName - Output subfolder name for this run's application artifacts.
 * @param doResumeArtifact - Whether resume artifact generation is enabled for qualifying jobs.
 * @param doCoverArtifact - Whether cover-letter generation is enabled for qualifying jobs.
 * @returns Ordered list of `JobResult` entries matching original JSONL order.
 */
async function processJobs(
  jsonlPath:           string,
  profile:             unknown,
  aliases:             Record<string, string>,
  extractorConfig:     { model: string; max_tokens: number; temperature: number; throttle_ms: number; reasoning?: Record<string, unknown> },
  judgeConfigArg:      { model: string; max_tokens: number; temperature: number; throttle_ms: number; reasoning?: Record<string, unknown> },
  coverLetterConfigArg: CoverLetterConfig,
  resumeGeneratorConfigArg: ResumeGenConfig,
  scoringWeights:      ScoringWeights,
  scoringThreshold:    number,
  profileEmbedding:    Float32Array | null,
  resumeText:          string | null,
  canonicalResumeTex:  string | null,
  experienceBlock:     string,
  rolesList:           string,
  canonicalSkillsText: string,
  nowIso:              string,
  repoRoot:            string,
  runIdForArtifacts:   string,
  runFolderName:       string,
  doResumeArtifact:    boolean,
  doCoverArtifact:     boolean,
): Promise<JobResult[]> {
  // ---------------------------------------------------------------------------
  // Phase 1 — read all JSONL lines + synchronous sanitize/hard-filter
  //
  // Reading everything first gives every job a stable number before any async
  // work starts. No readline streaming: we need the full list to fan out.
  // ---------------------------------------------------------------------------
  const rawLines = fs.readFileSync(jsonlPath, "utf-8").split(/\r?\n/);

  // Shared fixture counter. Increment is always in a synchronous block after
  // an await, so JS single-threaded scheduling keeps it race-free.
  // Seed counter from existing real-data fixtures on disk so the cap
  // (count < 5) is GLOBAL across runs, not per-run. Otherwise unattended
  // mode would write up to 5 new files every run forever.
  const fixtureRef = {
    count: SAVE_FIXTURES
      ? (fs.existsSync(FIXTURES_DIR)
          ? fs.readdirSync(FIXTURES_DIR)
              .filter(f => /^jd-real-\d+-.*-input\.txt$/.test(f))
              .length
          : 0)
      : 0,
  };

  interface PassEntry { jobNum: number; sanitized: any }
  const rejects:   Array<{ jobNum: number; result: JobResult }> = [];
  const passQueue: PassEntry[] = [];

  let jobNum = 0;
  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let raw: any;
    try { raw = JSON.parse(trimmed); }
    catch { log(`Skipping malformed line`); continue; }

    jobNum++;
    const n = jobNum;

    // Stage 3 — sanitize
    const sanitized = sanitizeJob(raw);

    // Stage 4 — hard filter
    const filterResult = hardFilter(sanitized, profile as any);

    if (filterResult.verdict === "REJECT") {
      rejects.push({
        jobNum: n,
        result: {
          title:      sanitized.title         ?? "",
          company:    sanitized.company?.name ?? "",
          source_url: sanitized.meta?.source_url ?? null,
          verdict:    "REJECT",
          reason:     filterResult.reason     ?? null,
          flags:      [...new Set(filterResult.flags ?? [])],
        },
      });
      continue;  // bible: REJECTs are dropped after stage 4
    }

    log(`[${n}] PASS: ${sanitized.title} @ ${sanitized.company?.name}`);
    passQueue.push({ jobNum: n, sanitized });
  }

  // ---------------------------------------------------------------------------
  // Stage 2 — Cross-run exact dedup (Redis)
  //
  // Batch-checks every PASS job_id against the Redis seen-set.
  // Jobs seen in a recent run (7-day TTL) are moved to the `dedups` list and
  // skipped from expensive fetch/extract/judge/cover-letter stages.
  // Gracefully disabled when SKIP_DEDUP=1 or Redis is unreachable.
  // ---------------------------------------------------------------------------
  const dedups: Array<{ jobNum: number; result: JobResult }> = [];

  if (!SKIP_DEDUP) {
    const seenFlags = await Promise.all(
      passQueue.map(e => isSeen(SOURCE, e.sanitized.meta?.job_id ?? "")),
    );
    const remaining: typeof passQueue = [];
    for (let i = 0; i < passQueue.length; i++) {
      if (seenFlags[i]) {
        const { jobNum: n, sanitized: s } = passQueue[i];
        log(`[${n}] DEDUP: ${s.title} @ ${s.company?.name} (seen in a recent run)`);
        dedups.push({
          jobNum: n,
          result: {
            title:      s.title         ?? "",
            company:    s.company?.name ?? "",
            source_url: s.meta?.source_url ?? null,
            verdict:    "DEDUP",
            reason:     "already_processed",
            flags:      [],
          },
        });
      } else {
        remaining.push(passQueue[i]);
      }
    }
    passQueue.length = 0;
    passQueue.push(...remaining);
  }

  // ---------------------------------------------------------------------------
  // "Target N new" cap (Option A)
  //
  // passQueue now holds the post-dedup survivors in listing order. When
  // TARGET_NEW is set, keep only the first N and drop the rest of the pool.
  // The dropped survivors are deliberately NOT processed and NOT marked seen
  // (markSeen runs per-job inside Phase 2), so the next run advances to them.
  // ---------------------------------------------------------------------------
  if (TARGET_NEW > 0) {
    const found = passQueue.length;
    if (found > TARGET_NEW) {
      passQueue.length = TARGET_NEW;
      log(`[target] ${TARGET_NEW} new job(s) selected from pool; ${found - TARGET_NEW} more left for the next run`);
    } else {
      log(`[target] only ${found} new job(s) found in pool of ${MAX_JOBS} (target ${TARGET_NEW}); increase pool or widen recency window`);
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 2 — concurrent async processing of PASS jobs (fetch→extract→score→judge)
  //
  // pLimit(5): at most 5 jobs running concurrently. Keeps Dice HTTP and
  // OpenRouter LLM load reasonable without serialising everything.
  // ---------------------------------------------------------------------------
  const limit = pLimit(5);

  const passPromises = passQueue.map(({ jobNum: n, sanitized }) =>
    limit(async (): Promise<{ jobNum: number; result: JobResult }> => {

      const jobId = (sanitized.meta?.job_id as string | undefined) ?? `job-${n}`;

      // Stage 5 — fetch JD
      // Sources like jobright_api populate description_raw at scrape time
      // by synthesizing it from structured API fields. In that case the
      // apply URL is a downstream ATS link (Oracle/Workday/Phenom/etc.)
      // that returns near-empty HTML to a plain HTTP fetcher anyway.
      // Skip the fetch when the scraper has already provided substantive prose.
      let fetchStatus: "ok" | "error" | "skipped" = "skipped";
      let judgeInputTokens      = 0;
      let judgeOutputTokens     = 0;
      let extractorInputTokens  = 0;
      let extractorOutputTokens = 0;

      if (hasUsableDescription(sanitized.description_raw)) {
        fetchStatus = "ok";
        log(`[${n}]  Description provided by scraper (${sanitized.description_raw.trim().length} chars), skipping fetch`);
      } else if (DO_EXTRACT) {
        log(`[${n}]  Fetching: ${sanitized.meta?.source_url}`);
        const fetchResult = await fetchJobPage(sanitized.meta?.source_url ?? "");
        fetchStatus = fetchResult.status;

        if (fetchResult.status === "ok") {
          sanitized.description_raw = fetchResult.description_raw;
          log(`[${n}]  Fetched: ${fetchResult.description_raw.length} chars`);
        } else {
          log(`[${n}]  Fetch failed: ${fetchResult.error}`);
          sanitized.meta.flags.push("fetch_failed");
        }
      }

      // Stage 6 — post-fetch checks (now has real description_raw if fetched)
      const checked = postFetchChecks(sanitized, nowIso);

      // Stage 7 — extract structured fields
      let extractStatus: "ok" | "error" | "skipped" = "skipped";
      let skills:    string[]     = [];
      let yoeMin:    number | null = null;
      let yoeMax:    number | null = null;
      let domain:    string | null = null;

      if (DO_EXTRACT) {
        if (!hasUsableDescription(sanitized.description_raw)) {
          extractStatus = "error";
          sanitized.meta.flags.push("no_usable_description");
          log(`[${n}]  No usable description after fetch → ARCHIVE`);
        } else {
        // Small courtesy pause — not rate-limit critical with reasoning disabled,
        // but avoids bursting all 3 concurrent slots simultaneously.
        if (extractorConfig.throttle_ms > 0) {
          await new Promise(r => setTimeout(r, extractorConfig.throttle_ms));
        }

        log(`[${n}]  Extracting...`);
        const extraction = await extract(sanitized.description_raw, extractorConfig);
        extractorInputTokens  += extraction.input_tokens  ?? 0;
        extractorOutputTokens += extraction.output_tokens ?? 0;
        extractStatus = extraction.status;

        if (extraction.status === "ok" && extraction.fields) {
          const f = extraction.fields;

          // Stage 10 — normalize skill names through alias map
          skills = f.required_skills.map(s => normalizeSkill(s.name, aliases));
          yoeMin = f.years_experience.min;
          yoeMax = f.years_experience.max;
          domain = f.domain;

          // Write extracted fields back onto job for downstream use
          sanitized.required_skills    = f.required_skills.map(s => ({
            ...s, name: normalizeSkill(s.name, aliases),
          }));
          sanitized.years_experience   = { min: f.years_experience.min, max: f.years_experience.max };
          sanitized.education_required = { minimum: f.education_required.minimum, field: f.education_required.field };
          sanitized.responsibilities   = f.responsibilities;
          sanitized.visa_sponsorship   = f.visa_sponsorship;
          sanitized.visa_quote         = f.visa_quote;
          sanitized.security_clearance = mapClearance(f.security_clearance, sanitized);
          sanitized.domain             = f.domain;

          // Clear stale flags that the hard filter set pre-extraction.
          // Extraction may now have data that resolves the uncertainty.
          const clearFlag = (flag: string) => {
            sanitized.meta.flags = sanitized.meta.flags.filter((x: string) => x !== flag);
          };
          if (f.years_experience.min != null || f.years_experience.max != null) {
            clearFlag("years_experience_missing");
          }
          if (f.visa_sponsorship !== "unmentioned") {
            clearFlag("sponsorship_unclear");
          }
          if (f.education_required.minimum && f.education_required.minimum !== "") {
            clearFlag("education_unparsed");
          }

          log(`[${n}]  Extracted: ${skills.length} skills, YOE ${yoeMin}-${yoeMax}, domain: ${domain}`);

          if (extraction.citation_failures && extraction.citation_failures > 0) {
            log(`[${n}]  Citation failures: ${extraction.citation_failures}`);
          }

          // Save real fixture pair when SAVE_FIXTURES=1 (up to 5 per run).
          // check+increment are in a synchronous block — JS single-threaded
          // scheduling keeps this race-free even with concurrent tasks.
          if (SAVE_FIXTURES && fixtureRef.count < 5 && sanitized.description_raw?.trim()) {
            fixtureRef.count++;
            const slug   = (sanitized.title ?? "job")
              .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 35);
            const num    = String(fixtureRef.count).padStart(3, "0");
            const prefix = `jd-real-${num}-${slug}`;
            fs.writeFileSync(path.join(FIXTURES_DIR, `${prefix}-input.txt`),  sanitized.description_raw);
            fs.writeFileSync(path.join(FIXTURES_DIR, `${prefix}-expected.json`), JSON.stringify(extraction.fields, null, 2));
            log(`[${n}]  Fixture saved: ${prefix}`);
          }
        } else {
          log(`[${n}]  Extraction failed: ${extraction.error}`);
          sanitized.meta.flags.push("extraction_failed");
        }
        }
      }

    // Stage 11 — deterministic scoring
    // Runs when DO_SCORE is set. Requires extraction for best results;
    // without it, skills/YOE components will be 0 (no data to compare).
    //
    // Skip scoring when extraction was attempted but failed: without skills
    // data, scoreSkills() returns 1.0 (no bar = perfect match) which produces
    // a misleading ~0.85 score and wastes a downstream judge LLM call.
    const extractionFailed = DO_EXTRACT && extractStatus === "error";
    let scoreResult: ScoreResult | undefined;
    let jobEmbedding: Float32Array | null = null;  // hoisted — also used by pgvector dedup + persist
    if (DO_SCORE && !extractionFailed) {
      try {
        jobEmbedding = await embedJob(sanitized);
      } catch {
        // embedding failure → semantic component = 0, score continues
      }

      scoreResult = scoreJob(
        sanitized as any,
        profile as any,
        jobEmbedding,
        profileEmbedding,
        scoringWeights,
        scoringThreshold,
      );

          log(`[${n}]  Score: ${scoreResult.score.toFixed(3)} (gate: ${scoreResult.gate_passed ? "PASS" : "FAIL"}) | skills=${scoreResult.components.skills.toFixed(2)} yoe=${scoreResult.components.yoe.toFixed(2)} sen=${scoreResult.components.seniority.toFixed(2)} loc=${scoreResult.components.location.toFixed(2)} sem=${scoreResult.components.semantic.toFixed(2)}`);
    } else if (extractionFailed) {
      log(`[${n}]  Score: skipped (extraction failed) → routing to ARCHIVE`);
    }

    // Stage 12 — threshold gate
    // gate_passed jobs proceed to the LLM judge.
    // gate_fail → ARCHIVE bucket.
    // extraction_failed → ARCHIVE (no reliable data to judge on).
    // When scoring is disabled, all PASS jobs go through as PASS (no gate).
    // sanitized.meta.flags is the live flag set — cleaned up after extraction
    // resolved earlier-flagged uncertainty. filterResult.flags is stale
    // (snapshotted before extraction). Merge live flags with post-fetch checks.
    const allFlags = [...new Set([...(sanitized.meta?.flags ?? []), ...checked])];

    // Flag jobs where extraction succeeded but returned no required skills.
    // Signals uncertain technical fit to the judge — scored at EMPTY_SKILLS_SCORE
    // rather than 1.0, but the flag lets the judge weigh this explicitly.
    if (DO_EXTRACT && extractStatus === "ok" && (sanitized.required_skills?.length ?? 0) === 0) {
      allFlags.push("skills_extraction_empty");
    }

    // Stage 12.5 — pgvector cross-site semantic dedup
    // Only runs on GATE_PASS jobs with an embedding — avoids calling the
    // judge on a job that's semantically identical to one we already processed.
    const provisionalGatePass = !extractionFailed && !!scoreResult && scoreResult.gate_passed;
    let isSemanticDuplicate = false;
    if (!SKIP_DEDUP && jobEmbedding && provisionalGatePass) {
      const dupJobId = await findSemanticDuplicate(Array.from(jobEmbedding), RUN_ID);
      if (dupJobId) {
        log(`[${n}]  Semantic dup of job ${dupJobId} → ARCHIVE`);
        allFlags.push("semantic_duplicate");
        isSemanticDuplicate = true;
      }
    }

    const routing = routeJob({
      doExtract: DO_EXTRACT,
      extractStatus,
      scored: !!scoreResult,
      gatePassed: scoreResult?.gate_passed ?? false,
      isSemanticDuplicate,
    });

    // Stage 13–14 — LLM judge + routing (GATE_PASS only)
    // Judge decides STRONG/MAYBE/WEAK verdict → FinalBucket. ARCHIVE jobs skip here entirely.
    let judgeResult: JudgeResult | undefined;
    let bucket: FinalBucket | undefined = routing.isArchived ? "ARCHIVE" : undefined;
    let finalVerdict = routing.isArchived ? "ARCHIVE" : routing.gateVerdict;

    if (DO_JUDGE && routing.shouldJudge && scoreResult) {
      // Throttle between LLM calls
      if (judgeConfigArg.throttle_ms > 0) {
        await new Promise(r => setTimeout(r, judgeConfigArg.throttle_ms));
      }

      log(`[${n}]  Judging...`);
      const judgeInput: JudgeInput = {
        run_id: RUN_ID,
        job_id: jobId,
        job: {
          title:             sanitized.title          ?? "",
          company:           sanitized.company?.name  ?? "",
          employment_type:   sanitized.employment_type ?? null,
          seniority:         sanitized.seniority       ?? null,
          domain:            sanitized.domain          ?? null,
          required_skills:   (sanitized.required_skills ?? []).map((s: any) => ({
            name:           s.name,
            importance:     s.importance ?? "required",
            years_required: s.years_required ?? null,
          })),
          years_experience:  {
            min: sanitized.years_experience?.min ?? null,
            max: sanitized.years_experience?.max ?? null,
          },
          education_required: {
            minimum: sanitized.education_required?.minimum ?? "",
            field:   sanitized.education_required?.field   ?? "",
          },
          visa_sponsorship:  sanitized.visa_sponsorship ?? "unmentioned",
          visa_quote:        sanitized.visa_quote ?? null,
          responsibilities:  sanitized.responsibilities  ?? [],
          flags:             allFlags,
        },
        score: {
          total:      scoreResult.score,
          components: {
            skills:    scoreResult.components.skills,
            semantic:  scoreResult.components.semantic,
            yoe:       scoreResult.components.yoe,
            seniority: scoreResult.components.seniority,
            location:  scoreResult.components.location,
          },
        },
        profile:             profile as Profile,
        roles_list:          rolesList || undefined,
        canonical_skills:    canonicalSkillsText || undefined,
        allowed_role_labels: canonicalResumeTex ? extractRoleLabels(canonicalResumeTex) : undefined,
      };

      judgeResult = await judge(judgeInput, judgeConfigArg);
      judgeInputTokens  += judgeResult.input_tokens  ?? 0;
      judgeOutputTokens += judgeResult.output_tokens ?? 0;
      bucket      = getBucket(judgeResult, scoreResult.score);
      finalVerdict = routing.gateVerdict;   // still GATE_PASS for the raw record; bucket is the real routing

      if (judgeResult.status === "ok") {
        log(`[${n}]  Judge: ${judgeResult.verdict} → ${bucket}`);
        if (judgeResult.fields?.concerns.length) {
          log(`[${n}]  Concerns: ${judgeResult.fields.concerns.join("; ")}`);
        }
      } else {
        log(`[${n}]  Judge error: ${judgeResult.error} → ${bucket}`);
        allFlags.push("judge_failed");
      }
    }

    // Stage 15 — Tailored resume + cover letter (parallel)
    // Only COVER_LETTER bucket and REVIEW_QUEUE jobs scoring >= rvqThreshold qualify.
    // Resume: signature cache checked first; patch_tailoring mode by default.
    let coverLetterPath: string | null  = null;
    let coverLetterWords: number | null = null;
    let resumePdfPath: string | null = null;
    let artifactInputTokens = 0;
    let artifactOutputTokens = 0;

    const rvqThreshold = Math.min(
      coverLetterConfigArg.review_queue_threshold ?? 0.70,
      resumeGeneratorConfigArg.review_queue_threshold ?? 0.70,
    );
    const qualifiesArtifacts = Boolean(
      scoreResult &&
      (bucket === "COVER_LETTER" ||
        (bucket === "REVIEW_QUEUE" && scoreResult.score >= rvqThreshold)),
    );
    const shouldArtifacts =
      DO_EXTRACT &&
      qualifiesArtifacts &&
      (doResumeArtifact || doCoverArtifact) &&
      Boolean(canonicalResumeTex);
    let resumeOutcome: Awaited<ReturnType<typeof generateAndSaveResume>> | null = null;
    let coverOutcome: Awaited<ReturnType<typeof generateAndSaveCoverLetter>> | null = null;
    let metaRel: string | null = null;

    if (shouldArtifacts) {
      if (resumeGeneratorConfigArg.throttle_ms > 0) {
        await new Promise(r => setTimeout(r, resumeGeneratorConfigArg.throttle_ms));
      }

      const bundle = buildArtifactBundle({
        sanitized: sanitized as import("@/filter/types").Job,
        scoreResult: scoreResult ?? null,
        judgeResult: judgeResult ?? null,
        profile: profile as Profile,
        canonical_resume_tex: canonicalResumeTex!,
        experience_block: experienceBlock,
      });

      if (!bundle.ok) {
        log(`[${n}]  Skipping artifact gen: ${bundle.reason}`);
        allFlags.push("artifact_bundle_invalid");
      } else {
        const jobSlug = makeJobSlug(
          {
            title:      bundle.job.title,
            company:    bundle.job.company.name,
            posted_at:  bundle.job.meta.posted_at,
          },
          jobId,
        );
        const runDir = path.join(repoRoot, "output", "applications", runFolderName);
        const jobFolderAbs = path.join(runDir, jobSlug);

        log(`[${n}]  Generating resume + cover letter → ${jobSlug}...`);

        writeJobDescription(bundle, jobFolderAbs);
        fs.mkdirSync(jobFolderAbs, { recursive: true });
        fs.writeFileSync(path.join(jobFolderAbs, "canonical.tex"), bundle.canonical_resume_tex, "utf8");

        let cachedResumeOutcome = doResumeArtifact
          ? await findCachedResumeOutcome(repoRoot, bundle, resumeGeneratorConfigArg)
          : null;
        if (cachedResumeOutcome) {
          log(`[${n}]  Resume cache hit: ${cachedResumeOutcome.tex_path}`);
          // FIX-12: copy cached tex/pdf into new job folder so this run's folder is self-contained
          if (cachedResumeOutcome.tex_path) {
            const newTexPath = path.join(jobFolderAbs, "resume.tex");
            try {
              await fs.promises.copyFile(cachedResumeOutcome.tex_path, newTexPath);
              cachedResumeOutcome = { ...cachedResumeOutcome, tex_path: newTexPath };
              if (cachedResumeOutcome.pdf_path) {
                const newPdfPath = path.join(jobFolderAbs, "resume.pdf");
                await fs.promises.copyFile(cachedResumeOutcome.pdf_path, newPdfPath);
                cachedResumeOutcome = { ...cachedResumeOutcome, pdf_path: newPdfPath };
              }
            } catch (e) {
              console.warn(`[cache] failed to copy cached tex to new folder: ${String(e).slice(0, 200)}`);
            }
          }
        }

        [resumeOutcome, coverOutcome] = await Promise.all([
          doResumeArtifact
            ? cachedResumeOutcome ?? generateAndSaveResume(bundle, resumeGeneratorConfigArg, repoRoot, jobFolderAbs, {
                runId: runIdForArtifacts, bucket: bucket ?? "UNKNOWN", generatedBy: "pipeline",
              })
            : Promise.resolve(null),
          doCoverArtifact
            ? generateAndSaveCoverLetter(bundle, coverLetterConfigArg, repoRoot, jobFolderAbs, {
                runId: runIdForArtifacts, bucket: bucket ?? "UNKNOWN", generatedBy: "pipeline",
              })
            : Promise.resolve(null),
        ]);

        // --- Post-generation audit (risk map ledger) ---
        if (resumeOutcome?.tex_path) {
          try {
            const resumeTex = fs.readFileSync(resumeOutcome.tex_path, "utf8");
            const { summary, ledger } = auditTailoredArtifact({
              tailoredText:  resumeTex,
              canonicalText: bundle.canonical_resume_tex,
              jobId,
              runId:         runIdForArtifacts,
              artifactType:  "resume",
            });
            (resumeOutcome.meta as Record<string, unknown>).risk_summary  = summary;
            applyResumeAttributionOverrunFlag(resumeOutcome.flags, summary);
            (resumeOutcome.meta as Record<string, unknown>).flags = resumeOutcome.flags;
            (resumeOutcome.meta as Record<string, unknown>).export_status = summary.human_review_items.length > 0 ? "needs_review" : "ok";
            if (!SKIP_PERSIST) await insertLedgerEntries(ledger);
          } catch (e) {
            log(`[${n}]  audit(resume) failed: ${e}`);
          }
        }

        if (coverOutcome?.tex_path) {
          try {
            const coverTex = fs.readFileSync(coverOutcome.tex_path, "utf8");
            const { summary, ledger } = auditTailoredArtifact({
              tailoredText:  coverTex,
              canonicalText: bundle.canonical_resume_tex,
              jobId,
              runId:         runIdForArtifacts,
              artifactType:  "cover_letter",
            });
            (coverOutcome.meta as Record<string, unknown>).risk_summary  = summary;
            (coverOutcome.meta as Record<string, unknown>).export_status = summary.human_review_items.length > 0 ? "needs_review" : "ok";
            if (!SKIP_PERSIST) await insertLedgerEntries(ledger);
          } catch (e) {
            log(`[${n}]  audit(cover) failed: ${e}`);
          }
        }

        let evals: ReturnType<typeof runEvals> | null = null;
        try {
          const patchOps = (resumeOutcome?.meta.patch_ops as unknown[]) ?? [];
          let finalTex: string | undefined;
          if (resumeOutcome?.tex_path) {
            try { finalTex = fs.readFileSync(resumeOutcome.tex_path, "utf-8"); } catch {}
          }
          evals = runEvals({
            canonicalTex:      bundle.canonical_resume_tex,
            finalTex,
            judgeJson:         bundle.judge_json as Parameters<typeof runEvals>[0]["judgeJson"],
            patchOps:          patchOps as Parameters<typeof runEvals>[0]["patchOps"],
            resumeFlags:       resumeOutcome?.flags ?? [],
            patchPromptSha:    (resumeOutcome?.meta.patch_prompt_sha as string | null) ?? null,
            coverLetterText:   coverOutcome?.text ?? (coverOutcome ? null : undefined),
            coverFlags:        coverOutcome?.flags ?? [],
            coverWordCount:    coverOutcome?.word_count ?? 0,
            coverPromptSha:    (coverOutcome?.meta?.prompt_sha as string | null) ?? null,
            jdRequiredSkills:  (bundle.job.required_skills ?? [])
              .filter((s: { importance: string; name: string }) => s.importance === "required")
              .map((s: { importance: string; name: string }) => s.name),
          });
        } catch (e) {
          console.warn(`[run-pipeline] evals failed: ${e}`);
        }

        writeCombinedMeta(
          jobFolderAbs,
          repoRoot,
          bundle,
          resumeOutcome,
          coverOutcome,
          { runId: runIdForArtifacts, bucket: bucket ?? "UNKNOWN", generatedBy: "pipeline" },
          evals,
        );

        metaRel = path.relative(repoRoot, path.join(jobFolderAbs, "meta.json"));

        if (resumeOutcome) {
          allFlags.push(...resumeOutcome.flags);
          if (resumeOutcome.tex_path) {
            log(`[${n}]  Resume: ${resumeOutcome.tex_path} (${resumeOutcome.word_count}w)`);
            resumePdfPath = resumeOutcome.pdf_path
              ? path.relative(repoRoot, resumeOutcome.pdf_path)
              : null;
          }
        }

        if (coverOutcome) {
          allFlags.push(...coverOutcome.flags);
          if (coverOutcome.tex_path) {
            coverLetterWords = coverOutcome.word_count;
            coverLetterPath = coverOutcome.pdf_path
              ? path.relative(repoRoot, coverOutcome.pdf_path)
              : path.relative(repoRoot, coverOutcome.tex_path);
            log(`[${n}]  Cover: ${coverOutcome.tex_path} (${coverLetterWords}w)`);
          }
        }

        if (resumeOutcome) {
          artifactInputTokens += Number(resumeOutcome.meta.input_tokens ?? 0);
          artifactOutputTokens += Number(resumeOutcome.meta.output_tokens ?? 0);
        }
        if (coverOutcome) {
          artifactInputTokens += Number(coverOutcome.meta.input_tokens ?? 0);
          artifactOutputTokens += Number(coverOutcome.meta.output_tokens ?? 0);
        }
      }
    }

    // Stage 16 — persist to Postgres + mark seen in Redis
    // Runs after all stages so a mid-run crash doesn't mark the job as seen
    // prematurely (it would be retried on the next run).
    if (!SKIP_PERSIST) {
      const jobRecord: JobRecord = {
        job_id:          jobId,
        run_id:          RUN_ID,
        source:          SOURCE,
        source_url:      sanitized.meta?.source_url    ?? null,
        title:           sanitized.title               ?? null,
        company:         sanitized.company?.name       ?? null,
        posted_at:       sanitized.meta?.posted_at     ?? null,
        scraped_at:      sanitized.meta?.scraped_at    ?? null,
        description_raw: sanitized.description_raw     ?? null,
        meta:            sanitized.meta                ?? null,
        extracted:       sanitized.required_skills?.length
                           ? { required_skills: sanitized.required_skills,
                               years_experience: sanitized.years_experience,
                               education_required: sanitized.education_required,
                               visa_sponsorship: sanitized.visa_sponsorship,
                               visa_quote: sanitized.visa_quote,
                               security_clearance: sanitized.security_clearance,
                               domain: sanitized.domain,
                               responsibilities: sanitized.responsibilities }
                           : null,
        embedding:       jobEmbedding ? Array.from(jobEmbedding) : null,
        filter_verdict:  finalVerdict,
        filter_flags:    allFlags,
        score: scoreResult ? {
          total:     scoreResult.score,
          skills:    scoreResult.components.skills,
          semantic:  scoreResult.components.semantic,
          yoe:       scoreResult.components.yoe,
          seniority: scoreResult.components.seniority,
          location:  scoreResult.components.location,
        } : null,
        judge_verdict:   judgeResult?.verdict            ?? null,
        judge_bucket:    bucket                          ?? null,
        judge_reasoning: judgeResult?.fields?.reasoning  ?? null,
        judge_concerns:  judgeResult?.fields?.concerns   ?? [],
        judge_model:               judgeResult?.model ?? null,
        judge_confidence:          judgeResult?.fields?.confidence ?? null,
        judge_key_matches:         judgeResult?.fields?.key_matches ?? null,
        judge_gaps:                judgeResult?.fields?.gaps ?? null,
        judge_why_apply:           judgeResult?.fields?.why_apply ?? null,
        judge_tailoring_hints:     judgeResult?.fields
          ? {
              ...(judgeResult.fields.tailoring_hints ?? {}),
              ...(judgeResult.fields.gap_directives?.length
                ? { gap_directives: judgeResult.fields.gap_directives }
                : {}),
            }
          : null,
        judge_system_prompt_sha:   judgeResult?.system_prompt_sha ?? null,
        cover_letter_path:  coverLetterPath,
        cover_letter_words: coverLetterWords,
        cover_letter_model: coverLetterPath ? coverLetterConfigArg.model : null,
      };
      await saveJob(jobRecord);

      if (resumeOutcome?.tex_path && metaRel) {
        await insertTailoredResumeArtifact({
          job_id:          jobId,
          run_id:          runIdForArtifacts,
          tex_path:        path.relative(repoRoot, resumeOutcome.tex_path),
          pdf_path:        resumeOutcome.pdf_path ? path.relative(repoRoot, resumeOutcome.pdf_path) : null,
          meta_path:       metaRel,
          word_count:      resumeOutcome.word_count,
          model:           String(resumeOutcome.meta.model ?? resumeGeneratorConfigArg.model),
          prompt_sha:      String(resumeOutcome.meta.prompt_sha ?? ""),
          canonical_sha:   String(resumeOutcome.meta.canonical_sha ?? ""),
          input_tokens:    (resumeOutcome.meta.input_tokens as number | null) ?? null,
          output_tokens:   (resumeOutcome.meta.output_tokens as number | null) ?? null,
          compile_status:  String(resumeOutcome.meta.compile_status ?? "failed"),
          generated_by:    String(resumeOutcome.meta.generated_by ?? "pipeline"),
          flags:           resumeOutcome.flags,
        });
      }

      if (coverOutcome?.tex_path && metaRel) {
        await insertCoverLetterArtifact({
          job_id:          jobId,
          run_id:          runIdForArtifacts,
          content:         null,
          file_path:       coverLetterPath,
          tex_path:        path.relative(repoRoot, coverOutcome.tex_path),
          pdf_path:        coverOutcome.pdf_path ? path.relative(repoRoot, coverOutcome.pdf_path) : null,
          meta_path:       metaRel,
          word_count:      coverLetterWords,
          model:           String(coverOutcome.meta.model ?? coverLetterConfigArg.model),
          prompt_sha:      String(coverOutcome.meta.prompt_sha ?? ""),
          canonical_sha:   String(coverOutcome.meta.canonical_sha ?? ""),
          input_tokens:    (coverOutcome.meta.input_tokens as number | null) ?? null,
          output_tokens:   (coverOutcome.meta.output_tokens as number | null) ?? null,
          compile_status:  String(coverOutcome.meta.compile_status ?? "failed"),
          generated_by:    "pipeline",
          flags:           coverOutcome.flags,
        });
      }
    }

    if (!SKIP_DEDUP) {
      await markSeen(SOURCE, jobId);
    }

    return {
      jobNum: n,
      result: {
        title:               sanitized.title         ?? "",
        company:             sanitized.company?.name ?? "",
        source_url:          sanitized.meta?.source_url ?? null,
        verdict:             finalVerdict,
        reason:              null,
        flags:               allFlags,
        skills:              skills.length ? skills : undefined,
        yoe_min:             yoeMin,
        yoe_max:             yoeMax,
        domain:              domain ?? undefined,
        fetch_status:        fetchStatus,
        extract_status:      extractStatus,
        score:               scoreResult,
        judge_verdict:       judgeResult?.verdict   ?? null,
        judge_reasoning:     judgeResult?.fields?.reasoning ?? null,
        judge_concerns:      judgeResult?.fields?.concerns  ?? [],
        bucket,
        cover_letter_path:   coverLetterPath,
        cover_letter_words:  coverLetterWords,
        resume_pdf_path:     resumePdfPath,
        artifact_input_tokens:    artifactInputTokens    || undefined,
        artifact_output_tokens:   artifactOutputTokens   || undefined,
        judge_input_tokens:       judgeInputTokens       || undefined,
        judge_output_tokens:      judgeOutputTokens      || undefined,
        extractor_input_tokens:   extractorInputTokens   || undefined,
        extractor_output_tokens:  extractorOutputTokens  || undefined,
      },
    };
  })); // end limit()

  // Merge rejects + dedups + pass results, sort by original jobNum to preserve input order
  const passResults = await Promise.all(passPromises);
  return [...rejects, ...dedups, ...passResults]
    .sort((a, b) => a.jobNum - b.jobNum)
    .map(r => r.result);
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/**
 * Prints human-readable run summary for CLI operators.
 *
 * Keeps bucket, score, and flag reporting in one place so unattended logs and
 * manual runs expose same triage signal after pipeline completion.
 *
 * @param results - Ordered per-job pipeline outcomes for current run.
 * @param source - Source label shown in summary header.
 * @param threshold - Active score gate threshold used for Stage 12.
 * @returns Nothing. Writes formatted summary to stdout.
 */
function printResults(results: JobResult[], source: string, threshold: number): void {
  const SEP = "─".repeat(90);

  console.log(`\n${SEP}`);
  console.log(`  ${source.toUpperCase()} — ${results.length} jobs processed`);
  console.log(SEP);

  for (const r of results) {
    const icon = r.verdict === "REJECT"                    ? "✗"
               : r.verdict === "DEDUP"                     ? "↩"
               : r.verdict === "ARCHIVE"                   ? "○"
               : r.bucket  === "COVER_LETTER"              ? "★"
               : r.bucket  === "RESULTS"                   ? "✓"
               : r.bucket  === "REVIEW_QUEUE"              ? "?"
               : r.bucket  === "ARCHIVE"                   ? "○"
               : "·";

    const title   = pad(r.title,   42);
    const company = pad(r.company, 22);

    let detail: string;
    if (r.verdict === "REJECT") {
      detail = `REJECT  ${r.reason ?? ""}`;
    } else if (r.verdict === "ARCHIVE") {
      detail = `ARCHIVE  score=${r.score?.score.toFixed(3) ?? "?"}`;
    } else if (r.verdict === "GATE_PASS" && r.bucket) {
      const judgeTag = r.judge_verdict ? ` [${r.judge_verdict}]` : "";
      detail = `${r.bucket}${judgeTag}  score=${r.score?.score.toFixed(3) ?? "?"}`;
    } else if (r.verdict === "GATE_PASS") {
      detail = `GATE_PASS  score=${r.score?.score.toFixed(3) ?? "?"}`;
    } else {
      detail = "PASS";
    }

    const flags = r.flags.length ? `  [${r.flags.join(", ")}]` : "";
    console.log(`  ${icon}  ${title}  ${company}  ${detail}${flags}`);

    // Show score breakdown
    if (r.score && r.verdict !== "REJECT") {
      const c = r.score.components;
      console.log(
        `       score: skills=${c.skills.toFixed(2)} yoe=${c.yoe.toFixed(2)} ` +
        `seniority=${c.seniority.toFixed(2)} location=${c.location.toFixed(2)} ` +
        `semantic=${c.semantic.toFixed(2)}`
      );
    }

    // Show judge reasoning when present
    if (r.judge_reasoning) {
      console.log(`       judge:  ${r.judge_reasoning}`);
    }

    // Show cover letter path when generated
    if (r.cover_letter_path) {
      console.log(`       cover:  ${r.cover_letter_path} (${r.cover_letter_words} words)`);
    }

    // Show extracted skills
    if ((r.verdict === "GATE_PASS" || r.verdict === "PASS") && r.skills?.length) {
      const yoe = r.yoe_min != null
        ? ` | YOE: ${r.yoe_min}${r.yoe_max ? `-${r.yoe_max}` : "+"}yrs`
        : "";
      const dom = r.domain ? ` | domain: ${r.domain}` : "";
      console.log(`       skills: ${r.skills.slice(0, 8).join(", ")}${r.skills.length > 8 ? "…" : ""}${yoe}${dom}`);
    }
  }

  // Summary
  const passed     = results.filter(r => r.verdict === "PASS");
  const gatePassed = results.filter(r => r.verdict === "GATE_PASS");
  const archived   = results.filter(r => r.verdict === "ARCHIVE");
  const rejected   = results.filter(r => r.verdict === "REJECT");
  const deduped    = results.filter(r => r.verdict === "DEDUP");

  const coverLetter  = results.filter(r => r.bucket === "COVER_LETTER");
  const resultsQueue = results.filter(r => r.bucket === "RESULTS");
  const reviewQueue  = results.filter(r => r.bucket === "REVIEW_QUEUE");
  const archiveBucket = results.filter(r => r.bucket === "ARCHIVE");

  console.log(`\n${SEP}`);
  console.log(`  SUMMARY`);
  console.log(SEP);
  console.log(`  Total        ${results.length}`);
  console.log(`  Passed       ${passed.length + gatePassed.length}  (hard filter pass)`);
  if (DO_SCORE) {
    if (DO_JUDGE && gatePassed.length > 0) {
      console.log(`  Gate PASS    ${gatePassed.length}  (score >= ${threshold})`);
      console.log(`  ├─ COVER_LETTER  ${coverLetter.length}   STRONG + score ≥ 0.70`);
      console.log(`  ├─ RESULTS       ${resultsQueue.length}   STRONG + score < 0.70`);
      console.log(`  ├─ REVIEW_QUEUE  ${reviewQueue.length}   MAYBE`);
      console.log(`  └─ ARCHIVE       ${archiveBucket.length}   WEAK or judge error`);
    } else {
      console.log(`  Gate PASS    ${gatePassed.length}  (score >= ${threshold})`);
    }
    console.log(`  Archive      ${archived.length}  (score < ${threshold})`);
  }
  console.log(`  Rejected     ${rejected.length}  (hard filter reject)`);
  if (deduped.length) {
    console.log(`  Deduped      ${deduped.length}  (seen in recent run — skipped)`);
  }

  if (DO_SCORE && (gatePassed.length + archived.length) > 0) {
    const scored = [...gatePassed, ...archived];
    const avgScore = scored.reduce((s, r) => s + (r.score?.score ?? 0), 0) / scored.length;
    const maxScore = Math.max(...scored.map(r => r.score?.score ?? 0));
    console.log(`\n  Scores:  avg=${avgScore.toFixed(3)}  max=${maxScore.toFixed(3)}  threshold=${threshold}`);

    // Component averages (useful for tuning weights)
    const avgComp = {
      skills:    avg(scored.map(r => r.score?.components.skills    ?? 0)),
      yoe:       avg(scored.map(r => r.score?.components.yoe       ?? 0)),
      seniority: avg(scored.map(r => r.score?.components.seniority ?? 0)),
      location:  avg(scored.map(r => r.score?.components.location  ?? 0)),
      semantic:  avg(scored.map(r => r.score?.components.semantic  ?? 0)),
    };
    console.log(
      `  Avg components:  skills=${avgComp.skills.toFixed(2)}  ` +
      `yoe=${avgComp.yoe.toFixed(2)}  seniority=${avgComp.seniority.toFixed(2)}  ` +
      `location=${avgComp.location.toFixed(2)}  semantic=${avgComp.semantic.toFixed(2)}`
    );
  }

  if (rejected.length) {
    console.log(`\n  Reject reasons:`);
    for (const [reason, count] of tally(rejected.map(r => r.reason ?? "unknown"))) {
      console.log(`    ${String(count).padStart(3)}x  ${reason}`);
    }
  }

  const allFlags = results.flatMap(r => r.flags);
  if (allFlags.length) {
    console.log(`\n  Flags:`);
    for (const [flag, count] of tally(allFlags)) {
      console.log(`    ${String(count).padStart(3)}x  ${flag}`);
    }
  }

  if (DO_EXTRACT) {
    const allPassed = [...passed, ...gatePassed, ...archived];
    const extracted = allPassed.filter(r => r.extract_status === "ok");
    const fetchFail = allPassed.filter(r => r.fetch_status   === "error");
    console.log(`\n  Extraction: ${extracted.length}/${allPassed.length} successful`);
    if (fetchFail.length) console.log(`  Fetch failures: ${fetchFail.length}`);
  }

  if (DO_RESUME_ARTIFACT) {
    const resumes = results.filter(r => r.resume_pdf_path);
    const failed  = results.filter(r => r.flags?.includes("resume_gen_failed"));
    if (resumes.length) {
      console.log(`\n  Resumes written: ${resumes.length}`);
      for (const r of resumes) {
        console.log(`    ${r.title} @ ${r.company} → ${r.resume_pdf_path}`);
      }
    } else {
      console.log(`\n  Resumes: none`);
    }
    if (failed.length) {
      console.log(`  Resume gen failed: ${failed.length}`);
      for (const r of failed) {
        console.log(`    ${r.title} @ ${r.company}`);
      }
    }
  }

  if (DO_COVER_ARTIFACT) {
    const letters = results.filter(r => r.cover_letter_path);
    if (letters.length) {
      console.log(`\n  Cover letters written: ${letters.length}`);
      for (const r of letters) {
        console.log(`    ${r.title} @ ${r.company} → ${r.cover_letter_path}`);
      }
    } else if (coverLetter.length === 0) {
      console.log(`\n  Cover letters: none (no COVER_LETTER bucket jobs this run)`);
    }
  }

  console.log(`${SEP}\n`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Counts repeated strings and sorts descending by frequency.
 *
 * @param items - Labels, reasons, or flags to aggregate.
 * @returns Tuple list of `[value, count]`, highest count first.
 */
function tally(items: string[]): [string, number][] {
  const map: Record<string, number> = {};
  for (const item of items) map[item] = (map[item] ?? 0) + 1;
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

/**
 * Pads or truncates text for fixed-width console summary columns.
 *
 * @param s - Raw text to fit into display column.
 * @param len - Target visible width in characters.
 * @returns String padded with spaces or truncated with ellipsis.
 */
function pad(s: string, len: number): string {
  if (!s) s = "";
  return s.length > len ? s.slice(0, len - 1) + "…" : s.padEnd(len);
}

/**
 * Computes arithmetic mean for possibly empty numeric list.
 *
 * @param nums - Numeric values to average.
 * @returns Mean of all values, or `0` when list is empty.
 */
function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

/**
 * Maps extractor clearance enum onto hard-filter clearance vocabulary.
 *
 * Normalizes softer extractor states into conservative downstream semantics:
 * a hard `required` becomes `secret`, while vague signals fall back to `none`
 * plus `clearance_unclear` so filters and reviewers can treat them cautiously.
 *
 * @param extractorValue - Extractor output such as `required` or `unknown`.
 * @param job - Mutable sanitized job whose `meta.flags` may receive uncertainty marker.
 * @returns Filter-compatible clearance string.
 */
function mapClearance(extractorValue: string, job: any): string {
  switch (extractorValue) {
    case "none":
      return "none";
    case "required":
      return "secret";
    case "preferred":
    case "unknown":
      if (!job.meta.flags.includes("clearance_unclear")) {
        job.meta.flags.push("clearance_unclear");
      }
      return "none";
    default:
      if (!job.meta.flags.includes("clearance_unclear")) {
        job.meta.flags.push("clearance_unclear");
      }
      return "none";
  }
}

/**
 * Writes pipeline log line to stderr with stable prefix for grep-able run logs.
 *
 * @param msg - Already-formatted message body.
 * @returns Nothing. Emits to stderr.
 */
function log(msg: string): void {
  process.stderr.write(`[pipeline] ${msg}\n`);
}

/**
 * Terminates pipeline immediately with prefixed fatal error message.
 *
 * @param msg - Human-readable fatal error detail.
 * @returns Never returns.
 * @throws Exits process with status code `1`.
 */
function die(msg: string): never {
  process.stderr.write(`[pipeline] ERROR: ${msg}\n`);
  process.exit(1);
}

/**
 * Mirrors stdout and stderr into per-run logfile for later audit/debug.
 *
 * Uses write monkey-patching instead of logger plumbing so existing `console`
 * and `process.stderr.write` calls across pipeline and imported modules land in
 * same file without invasive refactors.
 *
 * @param repoRoot - Repository root used to resolve default log directory.
 * @param source - Source label embedded in logfile name.
 * @param runId - Unique pipeline run identifier.
 * @param startedAt - Run start timestamp used for foldering and filenames.
 * @returns Absolute logfile path, or `null` when run logging is disabled.
 */
function installRunLog(repoRoot: string, source: string, runId: string, startedAt: Date): string | null {
  if (process.env.PIPELINE_DISABLE_RUN_LOG === "1") return null;

  const baseDir = path.resolve(process.env.OUTPUT_DIR ?? path.join(repoRoot, "output"), "logs", "runs");
  const dayDir = path.join(baseDir, makeDateFolderName(startedAt));
  fs.mkdirSync(dayDir, { recursive: true });

  const ts = startedAt.toISOString().replace(/[:.]/g, "-");
  const safeSource = source.replace(/[^a-zA-Z0-9_-]/g, "_");
  const shortRunId = runId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 8) || "manual";
  const runLabel = makeRunLabel(startedAt, runId).replace(/[^a-zA-Z0-9_-]/g, "_");
  const logPath = path.join(dayDir, `log_${ts}_${runLabel}_${safeSource}_${shortRunId}.log`);
  const stream = fs.createWriteStream(logPath, { flags: "a" });

  const mirror = <T extends typeof process.stdout.write>(original: T): T => {
    return ((chunk: unknown, ...args: unknown[]) => {
      try {
        stream.write(typeof chunk === "string" || Buffer.isBuffer(chunk) ? chunk : String(chunk));
      } catch {
        // Keep logging best-effort. Never let log capture break the run.
      }
      return original(chunk as never, ...(args as never[]));
    }) as T;
  };

  process.stdout.write = mirror(process.stdout.write.bind(process.stdout) as typeof process.stdout.write);
  process.stderr.write = mirror(process.stderr.write.bind(process.stderr) as typeof process.stderr.write);
  process.once("exit", () => stream.end());

  return logPath;
}

// ---------------------------------------------------------------------------

main().catch(err => {
  process.stderr.write(`[pipeline] Unhandled error: ${err}\n`);
  process.exit(1);
});
