# File and Method Reference — job-hunter (Section 4)

This is the low-level reference for **every file** in the system. For each file:

- **Purpose**
- **Exports / public interface** (signature + behavior + side effects)
- **Key internal functions** (important private logic)
- **Constants and configuration**

> Note: Many files are written in TypeScript ESM and import across `src/` via TS path aliases (`@/*`).

---

## scripts/run-pipeline.ts

**Purpose:** The main 19-stage pipeline runner (scrape → sanitize → hard filter → dedup → fetch → extract → score → judge → bucket → cover letter → persist).

**Exports / public interface:** None (script).

**Key internal functions (non-exported):**

- `main(): Promise<void>`
  - **What it does:** Orchestrates the full pipeline end-to-end for one run.
  - **Parameters:** none; configured entirely by env vars and config files.
  - **Returns:** resolves on completion; exits process with code 1 on fatal config errors.
  - **Side effects:** spawns Python scraper; calls OpenRouter; reads/writes Postgres/Redis; writes JSONL results; writes cover letter files.
- `runScraper(source, maxJobs, headed, query, postedWithin): string`
  - **What it does:** Runs `python -m scraper` and returns newest JSONL path for `source`.
  - **Side effects:** spawns `python`; writes `scraper/output/*.jsonl`.
- `findNewestJsonl(source): string | null`
  - **What it does:** Finds latest `scraper/output/{source}_*.jsonl` by mtime.
- `processJobs(...)`
  - **What it does:** Implements the two-phase pipeline:
    - phase 1: read JSONL, sanitize + hard filter
    - phase 1.5: Redis exact dedup
    - phase 2: pLimit(5) async pipeline stages per PASS job
  - **Side effects:** OpenRouter calls, cover letter writes, Postgres writes, Redis writes.
- `printResults(results, source, threshold): void`
  - **What it does:** Prints per-job summary and end-of-run aggregates.
- `mapClearance(extractorValue, job): string`
  - **What it does:** Maps extractor’s clearance enum into filter’s clearance enum and sets flags when unclear.

**Constants and configuration:**

- Reads config files from `config/` and loads `.env` from repo root.
- Gate threshold and weights come from `config/config.json` (with defaults).

---

## scripts/ui-server.ts

**Purpose:** Express 5 server for the Review UI: serves built SPA from `ui/dist/` and exposes the API endpoints used by the UI.

**Exports / public interface:** None (script).

**Key internal functions:**

- `readCoverLetter(filePath: string | null): string | null`
  - **What it does:** Reads cover letter text from disk.
  - **Special:** Tries stored path first, then historical substitution:
    - `/Users/.../Downloads/project/` → `/Users/.../Downloads/jobs/`
  - **Side effects:** `fs.readFileSync`.
- `main(): Promise<void>`
  - **What it does:** Connects to Postgres, runs migration `004_ui_application_tracking.sql`, registers endpoints, serves static UI build, starts server on **port 3001**.
  - **Side effects:** DB queries; static file serving; listens on TCP.

**HTTP endpoints (public interface):**

- `GET /api/apply-queue`
  - **Returns:** up to 200 rows of joined job/score/judge/cover_letter/label info for buckets `COVER_LETTER|REVIEW_QUEUE|RESULTS`.
  - **Cover letter behavior:** if `cover_letters.content` is null but `file_path` exists, reads cover letter from disk and returns `cover_letter` string or null.
- `GET /api/rejections-hard`
  - **Returns:** hard rejects from `filter_results.verdict='REJECT'` plus labels if present.
- `GET /api/rejections-soft`
  - **Returns:** soft rejects from judge bucket `ARCHIVE` plus labels if present.
- `GET /api/stats`
  - **Returns:** `{ pending, applyLater, applied, hardRejectionsUnreviewed, softRejectionsUnreviewed }`.
- `POST /api/label`
  - **Body:** `{ job_id, run_id, label, application_status?, notes? }`
  - **Behavior:** Upsert into `labels`, sets `applied_at` when `application_status='applied'`.

**Constants and configuration:**

- Port: **3001** (chosen because the default port is occupied on this dev machine).
- Static dir: `ui/dist`
- SPA fallback: `app.use(...)` (Express 5 safe).

---

## scripts/sort-log.ts

**Purpose:** Utility to reorder pipeline log lines grouped by job number, to make debugging easier.

**Exports / public interface:** None (script).

---

## src/orchestrator/index.ts

**Purpose:** Orchestrator entry point (`npm start`). Boots schedules, handles graceful shutdown, and keeps the process alive.

**Exports / public interface:** None (module is imported by script runner).

**Key internal functions:**

- `shutdown(reason: string): Promise<void>` — stops cron tasks, closes DB pools/Redis, exits.

---

## src/orchestrator/scheduler.ts

**Purpose:** Single source of truth for cron schedules and ghost reaper cadence.

**Exports / public interface:**

- `registerSchedules(): ScheduledTask[]`
  - **What it does:** Registers all cron tasks and returns handles with `stop()`.
  - **Side effects:** schedules cron callbacks that spawn runs and run ghost reaper.
- `closeSchedulerPool(): Promise<void>`
  - **What it does:** Closes the reaper pool used for ghost detection.
- `ScheduledTask` type: `{ stop: () => void }`

**Key internal functions:**

- `runReaper(): Promise<void>` — finds stale-heartbeat runs and marks them terminal (`exit_code=-1`, `finished_at=NOW()`), then releases Redis locks.
- `newRunId(): string` — `crypto.randomUUID()`.

**Constants and configuration:**

- Cron expressions and per-source `MAX`, `POSTED_WITHIN`, and `lockTtlSecs` are hardcoded here.

---

## src/orchestrator/lock.ts

**Purpose:** Redis `SET NX EX` lock per source to prevent overlapping runs.

**Exports / public interface:**

- `acquireLock(source: string, runId: string, ttlSecs: number): Promise<string | null>`
- `releaseLock(source: string): Promise<void>`
- `isLockHeld(source: string): Promise<boolean>`
- `closeRedis(): Promise<void>`
- `_resetLockClientForTesting(): void` (test helper)

**Side effects:** creates a Redis connection on demand; logs on initial connection error; idempotent release.

---

## src/orchestrator/runner.ts

**Purpose:** Supervise a single run: acquire lock, spawn pipeline child, pipe logs, heartbeat, exit code, monitor check, release lock.

**Exports / public interface:**

- `spawnRun(config: RunConfig): Promise<number>`
  - **Returns:** child exit code, or `-1` when lock not acquired.
- `closeRunnerPool(): Promise<void>`
- `RunConfig` type

**Key internals:**

- `updateHeartbeat(runId)` and `markExitCode(runId, code)` write to Postgres via inline SQL.
- SIGTERM/SIGINT forwarding logic with 30s grace then SIGKILL.

---

## src/orchestrator/monitor.ts

**Purpose:** Append orchestrator logs and perform post-run health checks.

**Exports / public interface:**

- `ensureLogDirs(): void`
- `appendOrchestratorLog(line: string): void`
- `appendReaperLog(line: string): void`
- `runLogPath(runId: string): string`
- `checkRun(source: string, runId: string, exitCode: number): Promise<void>`
- `closeMonitorPool(): Promise<void>`

**Side effects:** file writes to `output/logs/*` and stdout; best-effort Postgres reads.

---

## src/orchestrator/trigger-once.ts

**Purpose:** Run a single `spawnRun()` immediately without waiting for cron.

**Exports / public interface:** None (script-like module).

---

## src/filter/index.ts

**Purpose:** Public re-exports for filter module.

**Exports / public interface:** re-exports from `constants.ts`, `types.ts`, `validate.ts`, `sanitize.ts`, `filter.ts`, `post-fetch.ts`, `skills.ts`, `compensation.ts`, `config-loader.ts`.

---

## src/filter/constants.ts

**Purpose:** Shared enumerations, level maps, and flag constants used by filter + scoring + UI contracts.

**Exports / public interface:**

- `SENIORITY_LEVEL`, `DEGREE_LEVEL`
- enum arrays: `LOCATION_TYPES`, `EMPLOYMENT_TYPES`, `CLEARANCE_LEVELS`, `COMPENSATION_INTERVALS`
- `FX_TO_USD`
- `FLAGS` (string constants used as pipeline flags)
- `BUCKETS` (string constants for bucket names)
- `SOURCE_SCORE_WEIGHT_BY_SITE`

---

## src/filter/types.ts

**Purpose:** Canonical TypeScript job + profile + filter result types used by the pipeline.

**Exports / public interface:** `JobMeta`, `Compensation`, `JobLocation`, `RequiredSkill`, `Job`, `Profile*`, `Verdict`, `FilterResult`.

---

## src/filter/sanitize.ts

**Purpose:** Pure sanitizer for scraped job objects before hard filtering.

**Exports / public interface:**

- `sanitizeJob(job: Job): Job`

---

## src/filter/filter.ts

**Purpose:** Pure deterministic hard filter (listing-metadata-only checks).

**Exports / public interface:**

- `hardFilter(job: Job, profile: Profile): FilterResult`

**Side effects:** none (pure).

---

## src/filter/post-fetch.ts

**Purpose:** Post-fetch flagging checks (education regex recovery; staleness).

**Exports / public interface:**

- `postFetchChecks(job: Job, nowIso: string): string[]`

---

## src/filter/skills.ts

**Purpose:** Skill canonicalization and alias map builder.

**Exports / public interface:**

- `normalizeSkill(name: string | null | undefined, aliases: Record<string,string>): string`
- `buildAliasMap(skillsJson: Record<string, { canonical: string; aliases: string[] }>): Record<string,string>`

---

## src/filter/compensation.ts

**Purpose:** Normalize compensation and apply optional per-source score boost.

**Exports / public interface:**

- `toAnnualUSD(val, interval, currency): number | null`
- `applySourceScore(baseScore: number, job: Job): number`

---

## src/filter/validate.ts

**Purpose:** Validate `config/profile.json` structure at load time.

**Exports / public interface:**

- `validateProfile(profile: Profile): void` (throws on invalid profile)

---

## src/filter/config-loader.ts

**Purpose:** Load profile + skills dictionary, derive `profile.skills` from `skills.json`, validate, and produce alias map.

**Exports / public interface:**

- `loadConfig(configDir?: string): LoadedConfig`
- `buildAliasMap(dict: SkillDictionary): AliasMap`
- `buildProfileSkills(dict: SkillDictionary): Profile["skills"]`
- types: `SkillEntry`, `SkillDictionary`, `AliasMap`, `LoadedConfig`

---

## src/fetcher/index.ts

**Purpose:** Public re-exports for fetcher.

**Exports / public interface:** `fetchJobPage`, `extractText`, `isAllowedByRobots`, `FetchResult`.

---

## src/fetcher/fetch.ts

**Purpose:** Fetch job pages and convert HTML to plain text; includes polite per-domain delays and Dice URL normalization.

**Exports / public interface:**

- `fetchJobPage(url: string): Promise<FetchResult>` (never throws; returns status)
- `extractText(html: string): string`
- `isAllowedByRobots(url: string): Promise<boolean>`

**Key internals:**

- `normalizeDiceApplyRedirect(url)` — rewrite Dice apply-redirect to canonical job detail URL.
- `_respectDomainDelay(hostname)` — ensures 2s spacing per domain under concurrency.

---

## src/fetcher/types.ts

**Purpose:** Fetcher result type.

**Exports / public interface:** `FetchResult`.

---

## src/extractor/index.ts

**Purpose:** Public re-exports for extractor.

**Exports / public interface:** `extract`, `verifyCitations`, `validateExtraction`, prompts, types.

---

## src/extractor/client.ts

**Purpose:** OpenRouter chat completions client for extraction, with strict JSON schema response format (default).

**Exports / public interface:**

- `complete(opts: CompletionOptions): Promise<CompletionResult>`
- types: `ChatMessage`, `ReasoningConfig`, `CompletionOptions`, `CompletionResult`

**Side effects:** network calls to OpenRouter; requires `OPENROUTER_API_KEY`.

---

## src/extractor/schema.ts

**Purpose:** JSON Schema mirror of the Zod schema used for OpenRouter strict `json_schema` response_format.

**Exports / public interface:** `EXTRACTION_JSON_SCHEMA`.

---

## src/extractor/prompt.ts

**Purpose:** Extractor system prompt and user prompt builder.

**Exports / public interface:** `PROMPT_VERSION`, `SYSTEM_PROMPT`, `buildUserPrompt(descriptionRaw)`.

---

## src/extractor/validate.ts

**Purpose:** Zod validation and JSON parsing of extractor responses.

**Exports / public interface:** `ExtractedFieldsSchema`, `validateExtraction(raw)`, `ValidatedFields`.

---

## src/extractor/types.ts

**Purpose:** Extractor output field types (skills/YOE/education/domain/etc.).

**Exports / public interface:** `ExtractedFields`, `ExtractionResult`, plus subtypes.

---

## src/extractor/extract.ts

**Purpose:** Extract structured fields using OpenRouter; retry-once on validation failure; citation verification.

**Exports / public interface:**

- `extract(descriptionRaw: string, config: ExtractorConfig): Promise<ExtractionResult>`
- `verifyCitations(fields: ValidatedFields, descriptionRaw: string): { fields: ExtractedFields; citationFailures: number }`
- type: `ExtractorConfig`

---

## src/scorer/index.ts

**Purpose:** Public re-exports for scoring and embedding.

**Exports / public interface:** `scoreJob`, `DEFAULT_WEIGHTS`, `DEFAULT_THRESHOLD`, component scorers, embed functions, types.

---

## src/scorer/types.ts

**Purpose:** Score input/output types and weights.

**Exports / public interface:** `ScoringJobInput`, `ScoringProfileInput`, `ScoringWeights`, `ScoreComponents`, `ScoreResult`, plus skill types.

---

## src/scorer/components.ts

**Purpose:** Pure scoring components for skills/YOE/seniority/location/semantic.

**Exports / public interface:** `scoreSkills`, `scoreYOE`, `scoreSeniority`, `scoreLocation`, `scoreSemantic`.

---

## src/scorer/score.ts

**Purpose:** Composite scorer producing `ScoreResult` and gate pass/fail.

**Exports / public interface:** `scoreJob(...)`, `DEFAULT_WEIGHTS`, `DEFAULT_THRESHOLD`.

---

## src/scorer/embed.ts

**Purpose:** Lazy-load local embeddings model and produce 384-dim vectors; cache embeddings by hash.

**Exports / public interface:** `getEmbedder`, `embedText`, `embedProfile`, `embedJob`.

**Side effects:** downloads/loads model on first use; logs load status to stderr.

---

## src/judge/index.ts

**Purpose:** Public re-exports for judge.

**Exports / public interface:** `judge`, `getBucket`, validation, prompts, and types.

---

## src/judge/types.ts

**Purpose:** Judge input/output types and bucket enum.

**Exports / public interface:** `JudgeInput`, `JudgeResult`, `JudgeVerdict`, `FinalBucket`, etc.

**v15 changes:** `JudgeInput.profile` is now **required** (was optional). `JudgeInput.allowed_role_labels?: string[]` added — fed from `extractRoleLabels(canonicalResumeTex)` in the pipeline to gate which role labels the judge may emit.

---

## src/judge/prompt.ts

**Purpose:** System prompt and input formatter for LLM judge.

**Exports / public interface:** `PROMPT_VERSION`, `SYSTEM_PROMPT`, `buildSystemPrompt(allowedRoleLabels?: string[])`, `buildJudgePrompt(input)`.

**v15 changes:** `buildSystemPrompt` takes optional `allowedRoleLabels`; when provided, emits a dynamic "ALLOWED target_role VALUES — copy ONE verbatim" block with the exact label list so the judge cannot fabricate role labels.

---

## src/judge/validate.ts

**Purpose:** Zod validation and JSON parsing for judge responses.

**Exports / public interface:** `JudgeFieldsSchema`, `validateJudge(raw, allowedLabels?: string[])`, `ValidatedJudgeFields`.

**v15 changes:** `validateJudge` takes optional `allowedLabels`; after Zod parse, gates `gap_directives` and `tailoring_hints.tech_swaps` by exact normalized role label. Unknown roles are downgraded (handling→`"acknowledge"`, `target_role`→`null`) with concern flags `directive_role_unresolved:<label>` / `swap_role_unresolved:<label>`.

---

## src/judge/client.ts

**Purpose:** OpenRouter client for judge stage (JSON object mode).

**Exports / public interface:** `complete(opts)`, types.

---

## src/judge/judge.ts

**Purpose:** Judge orchestration (LLM call, retry, error wrapping) and bucket routing logic.

**Exports / public interface:** `judge(input, config)`, `getBucket(judgeResult, totalScore)`.

**v15 changes:** `defaultProfileForJudge()` removed. `allowed_role_labels` from `JudgeInput` is passed to `buildSystemPrompt` and `validateJudge`.

---

## src/cover-letter/index.ts

**Purpose:** Public re-exports for cover letter module.

**Exports / public interface:** prompt + generator + resume loader + types.

---

## src/cover-letter/types.ts

**Purpose:** Cover letter generator input/config/output types.

**Exports / public interface:** `CoverLetterInput`, `CoverLetterConfig`, `CoverLetterResult`, etc.

---

## src/cover-letter/prompt.ts

**Purpose:** Cover letter prompt rules and user prompt builder (strict style constraints).

**Exports / public interface:** `PROMPT_VERSION`, `SYSTEM_PROMPT`, `buildCoverLetterPrompt(input)`.

---

## src/cover-letter/client.ts

**Purpose:** OpenRouter client for cover letter generation (plain text).

**Exports / public interface:** `complete(opts)`, types.

---

## src/cover-letter/generate.ts

**Purpose:** Generate a cover letter and save it to disk (frontmatter + body).

**Exports / public interface:**

- `generateCoverLetter(input, config): Promise<CoverLetterResult>`
- `saveCoverLetter(result, input, outDir): string`

---

## src/cover-letter/resume.ts

**Purpose:** Load resume text (prefer `resume.tex`) and strip LaTeX to plain text.

**Exports / public interface:** `loadResume(configDir)`, `stripLatex(tex)`.

---

## src/dedup/index.ts

**Purpose:** Public re-exports for dedup.

**Exports / public interface:** Redis dedup functions and `findSemanticDuplicate`.

---

## src/dedup/redis.ts

**Purpose:** Cross-run exact dedup via Redis with TTL; best-effort non-throwing behavior.

**Exports / public interface:** `connectRedis`, `disconnectRedis`, `isSeen`, `markSeen`, `listSeenJobIds`.

---

## src/dedup/pgvector.ts

**Purpose:** Cross-site semantic dedup via pgvector cosine similarity query.

**Exports / public interface:** `findSemanticDuplicate(embedding, currentRunId, threshold?, lookbackDays?)`.

---

## src/storage/index.ts

**Purpose:** Public surface of storage module: pool, migrations, persist, types.

**Exports / public interface:** `getPool`, `closePool`, `runMigrations`, `saveRun`, `finishRun`, `saveJob`, `isSeenInDB`, disabled-state controls, and types.

---

## src/storage/db.ts

**Purpose:** Lazy Postgres pool singleton; better error formatting for AggregateError.

**Exports / public interface:** `getPool()`, `closePool()`, `_resetPoolForTesting()`.

---

## src/storage/migrate.ts

**Purpose:** Runs SQL migrations in alphabetical order; CLI-capable.

**Exports / public interface:** `runMigrations(): Promise<void>`

---

## src/storage/types.ts

**Purpose:** Input types for storage persistence (`RunRecord`, `RunStats`, `JobRecord`).

**Exports / public interface:** `RunRecord`, `RunStats`, `JobRecord`.

---

## src/storage/persist.ts

**Purpose:** Persist run/job results to Postgres using upserts; never throw; supports disabled-state when DB is down.

**Exports / public interface:**

- `saveRun(run: RunRecord): Promise<void>`
- `finishRun(runId: string, stats: RunStats): Promise<void>`
- `saveJob(job: JobRecord): Promise<void>`
- `isSeenInDB(source: string, jobId: string): Promise<boolean>`
- `insertTailoredResumeArtifact(row: TailoredResumeInsert): Promise<void>` — inserts a `tailored_resumes` row; `row.regeneration_reason` is included.
- `insertCoverLetterArtifact(row: CoverLetterArtifactInsert): Promise<void>` — inserts a `cover_letters` row; `row.regeneration_reason` is included.
- `getLatestTailoredResumeForJob(jobId: string): Promise<...>` — reads the most recent `tailored_resumes` row for cache-hit checking.
- `jobHasCompleteArtifacts(jobId: string): Promise<boolean>` — returns true only when both latest resume and cover rows have usable paths and no failure flags.
- `detectRegenerationReason(jobId: string): Promise<string | null>` — queries both tables for the latest flags and returns: `"previous_both_failed"`, `"previous_resume_gen_failed"`, `"previous_cover_gen_failed"`, `"manual_force"`, or `null` (DB disabled or no prior rows).
- Disabled-state controls: `markStorageDisabled(reason?)`, `isStorageAvailable()`
- Error helper: `formatErr(e)`
- Orchestrator helpers: `updateHeartbeat(runId)`, `markRunExitCode(runId, exitCode, isGhost?)`, `getUnfinishedRuns(staleMinutes?)`, `getRunStats(runId)`
- Test helper: `_resetDisabledForTesting()`

**Side effects:** DB writes (transactional per job) and logging; no file I/O.

---

## src/storage/integrity.ts

**Purpose:** Optional post-run integrity check comparing Redis seen-set vs Postgres `seen_jobs`.

**Exports / public interface:** `verifyIntegrity(source, redisSeenIds)`, `formatReport(report)`.

---

## src/storage/label-cli.ts

**Purpose:** CLI to label judged jobs in DB (calibration), writing to `labels`.

**Exports / public interface:** None (script-like).

---

## ui/src/api.ts

**Purpose:** Typed fetch wrappers for UI → server API calls.

**Exports / public interface:**

- Types: `Stats`, `ApplyQueueRow`, `HardRejectionRow`, `SoftRejectionRow`, etc.
- Functions: `getStats()`, `getApplyQueue()`, `getHardRejections()`, `getSoftRejections()`, `postLabel(payload)`

**Side effects:** HTTP fetch calls to relative `/api/*` paths.

---

## ui/src/App.tsx

**Purpose:** App shell: stats header + tabs switching between Apply Queue and rejection lists.

**Exports / public interface:** `App()` React component.

---

## ui/src/main.tsx

**Purpose:** React entry point; mounts `App` into `#root`.

**Exports / public interface:** None (entry module).

---

## ui/src/styles.css

**Purpose:** Dark theme styles and component layout CSS.

**Exports / public interface:** None (CSS).

---

## ui/src/components/Tabs.tsx

**Purpose:** Simple tab bar component.

**Exports / public interface:** `Tabs({ tabs, active, onChange })`.

---

## ui/src/components/JobCard.tsx

**Purpose:** Shared card renderer for Apply Queue, Hard Rejections, Soft Rejections; handles label/actions/notes UI.

**Exports / public interface:** `JobCard({ mode, row, onStatsUpdate })`.

---

## ui/src/tabs/ApplyQueue.tsx

**Purpose:** Apply Queue tab: fetches rows, provides filters (Pending/Applied/Not Applied/Apply Later), renders `JobCard`s.

**Exports / public interface:** `ApplyQueue({ onStatsUpdate })`.

---

## ui/src/tabs/HardRejections.tsx

**Purpose:** Hard rejections tab: fetches REJECT rows, groups by reason, renders `JobCard` in hard-reject mode.

**Exports / public interface:** `HardRejections({ onStatsUpdate })`.

---

## ui/src/tabs/SoftRejections.tsx

**Purpose:** Soft rejections tab: fetches ARCHIVE rows, filters by source/status, renders `JobCard` in soft-reject mode.

**Exports / public interface:** `SoftRejections({ onStatsUpdate })`.

---

## scraper/__main__.py

**Purpose:** Entry point that enables `python -m scraper`. Delegates immediately to `scraper/cli.py:main()`.

**Public interface:** Not callable directly — invoked by Python's `-m` flag.

---

## scraper/__init__.py

**Purpose:** Package marker. No exports.

---

## scraper/cli.py

**Purpose:** Python CLI for all scrapers (`python -m scraper --source ...`).

**Public interface:** CLI flags:

- `--source {dice|jobright|jobright_api|linkedin}`
- `--max N`
- `--headed`
- `--cookies PATH`
- `--hours-old` (LinkedIn)
- `--query` (Dice; default `None` — falls back to `load_scraping_config()["dice"]["query"]` at runtime)
- `--posted-within {ONE|THREE|SEVEN}` (Dice)

Exit codes: 0 success, 1 adapter error, 2 cookie file missing.

---

## scraper/dice.py

**Purpose:** Dice scraper (public search, paginated) with optional postedDate filter.

**Public interface:** `scrape(max_jobs, run_id, query="...", headless=True, posted_within=None) -> Iterator[dict]`.

---

## scraper/jobright_api.py

**Purpose:** Jobright API adapter (preferred Jobright path) with throttling and hard cap.

**Public interface:** `scrape(max_jobs=HARD_CAP, sort_condition=1, run_id="", cookies_path=...) -> Iterator[dict]`.

---

## scraper/jobright.py

**Purpose:** Jobright HTML scraper (fallback only; fragile hashed selectors).

**Public interface:** `scrape(max_jobs, run_id, cookies_path, headless=True) -> Iterator[dict]`.

---

## scraper/jobspy_adapter.py

**Purpose:** LinkedIn scraping via `python-jobspy` (requires `>= 1.1.82`), dedup across multiple search-term queries.

**Public interface:** `scrape(max_jobs, run_id, location="United States", hours_old=None, search_terms=None) -> Iterator[dict]`.

**Key behavior:**

- `hours_old` defaults to `None`; at runtime resolved from `load_scraping_config()["linkedin"]["hours_old"]` if not passed, falling back to `DEFAULT_PARAMS["hours_old"]` (5).
- `is_remote=False` in `DEFAULT_PARAMS` — required bool in python-jobspy ≥ 1.1.82; `False` includes both remote and onsite listings.
- `linkedin_fetch_description=True` — fetches full JD text via JobSpy.
- Runs one JobSpy call per search term from `config.scraping.linkedin.search_terms`; deduplicates results by URL before yielding.

---

## scraper/common/schema.py

**Purpose:** Canonical Python job dict schema matching `src/filter/types.ts`.

**Public interface:** `make_empty_job(...)`, `add_flag(job, flag)`, `FLAGS`.

---

## scraper/common/normalize.py

**Purpose:** Pure string parsing helpers (posted_at/location/employment/salary/seniority).

**Public interface:** `parse_posted_at`, `parse_location`, `parse_employment_type`, `parse_salary`, `guess_seniority`.

---

## scraper/common/cookies.py

**Purpose:** Sanitize browser cookie export format for Playwright.

**Public interface:** `load_cookies(path) -> list[dict]`.

---

## scraper/common/output.py

**Purpose:** JSONL write/read helpers and run_id generation.

**Public interface:** `make_run_id()`, `now_iso()`, `write_jsonl(...)`, `read_jsonl(path)`.

---

## scraper/common/app_config.py

**Purpose:** Load the project `config/config.json` and return the `scraping` sub-dict for use by Python scraper components.

**Public interface:**

- `load_scraping_config() -> dict`
  - **What it does:** Reads `config/config.json` relative to the repo root and returns the `scraping` key as a plain dict.
  - **Raises:** `FileNotFoundError` if `config/config.json` is not found.
  - **Used by:** `scraper/cli.py` (Dice query default), `scraper/jobspy_adapter.py` (LinkedIn search terms, location, hours_old).

---

## migrations/001_initial.sql

**Purpose:** Core schema: `runs`, `jobs` (with pgvector embedding), `filter_results`, `scores`, `judge_verdicts`, `cover_letters`, `seen_jobs`.

---

## migrations/002_orchestrator.sql

**Purpose:** Adds orchestrator supervision columns to `runs`: `exit_code`, `last_heartbeat`, `extractions_attempted`, `extractions_succeeded`, plus partial index for unfinished runs.

---

## migrations/003_labels.sql

**Purpose:** Adds `labels(job_id, run_id, label, notes, labeled_at)` for calibration.

---

## migrations/004_ui_application_tracking.sql

**Purpose:** Adds `application_status` and `applied_at` to `labels`, and check constraint/index for UI tracking.

---

## migrations/005_tailored_resumes.sql

**Purpose:** Creates `tailored_resumes` table for resume artifact metadata (tex_path, pdf_path, meta_path, word_count, model, prompt_sha, canonical_sha, tokens, compile_status, generated_by, flags, generated_at).

---

## migrations/006_cover_letter_artifacts.sql

**Purpose:** Extends `cover_letters` table with artifact columns added after v1 (tex_path, pdf_path, meta_path, prompt_sha, canonical_sha, input_tokens, output_tokens, compile_status, generated_by, flags).

---

## migrations/007_fabrication_ledger.sql

**Purpose:** Creates `fabrication_ledger` table for per-bullet attribution tracking (job_id, run_id, role, bullet_text, source_bullet_hash, truth_distance_score, risk_level, requires_human_review).

---

## migrations/008_resume_attribution.sql

**Purpose:** Resume attribution columns on `tailored_resumes` (attribution flags and overrun counter).

---

## migrations/009_cover_letter_prompt_sha.sql

**Purpose:** Adds `prompt_sha` and related fields to `cover_letters` for prompt version tracking.

---

## migrations/010_labels_notes.sql

**Purpose:** Adds `notes` field to `labels` table for freeform operator annotations.

---

## migrations/011_ledger_truth_distance_numeric.sql

**Purpose:** Changes `fabrication_ledger.truth_distance_score` from `INTEGER` to `NUMERIC` so fractional scores (0.05–0.2) from Phase-8 risk map entries can be stored without truncation.

---

## migrations/012_regeneration_reason.sql

**Purpose:** Adds `regeneration_reason TEXT DEFAULT NULL` to both `tailored_resumes` and `cover_letters`. Tracks why a given artifact row was generated when it replaces a prior attempt. Possible values: `null` (first generation), `previous_resume_gen_failed`, `previous_cover_gen_failed`, `previous_both_failed`, `manual_force`, `explicit:<reason>`.

**Idempotent:** Uses `ADD COLUMN IF NOT EXISTS`; safe to re-run.

---

## src/evals/types.ts

**Purpose:** TypeScript type definitions for the deterministic eval system.

**Exports:**

- `Quality` — `"improved" | "neutral" | "degraded"`
- `OverallQuality` — `"ok" | "warning" | "fail"`
- `EmphasisOpEval` — per-op eval for EMPHASIS rewrites: `{ role, item, original, rewritten, scores: { specificity_preserved, tech_forward_gain, info_loss, net_quality }, dropped_phrases }`
- `DirectiveOpEval` — per-op eval for fabricate/reframe directives: `{ role, jd_requirement, handling, scores: { requirement_addressed, metric_overclaim, banned_phrase } }`
- `ResumeEval` — `{ emphasis_ops, directive_ops, flags, overall_quality }`
- `CoverLetterEval` — `{ word_count, banned_phrase, banned_phrases_found, overall_quality }`
- `EvalResult` — `{ run_at, version: "1.0", patch_prompt_sha, cover_prompt_sha, resume, cover_letter }`
- `BatchJobRow` — per-job summary for batch reports
- `BatchSummary` — aggregated batch eval summary

---

## src/evals/runner.ts

**Purpose:** Deterministic post-generation quality evaluator. Requires no LLM. Runs as a post-generation pass inside `manual-generate.ts` and as a batch re-evaluator in `backfill-evals.ts`.

**Exports / public interface:**

- `EvalInput` interface — `{ canonicalTex, judgeJson, patchOps?, resumeFlags?, patchPromptSha?, coverLetterText?, coverFlags?, coverWordCount?, coverPromptSha? }`
- `runEvals(input: EvalInput): EvalResult`
  - **What it does:** Classifies patch ops into emphasis ops (role in `emphasize_roles` AND NOT in directive `target_role`s) and directive ops. Evaluates each emphasis rewrite using `evalEmphasisOp()` + `extractKeyTerms()`. Evaluates directive ops using `evalDirectiveOp()`. Rolls up overall quality for resume and cover letter.
  - **Side effects:** none (pure).

**Key internal functions:**

- `extractKeyTerms(tex: string): string[]` — extracts named tech terms (capitalized multi-word runs, first word filtered against ACTION_VERBS), context noun phrases (after "for/across/of/within" with qualifying noun type), and metrics with explicit units or `\d{2,}+` magnitudes.
- `evalEmphasisOp(original, rewritten, role, item, emphSkills)` — compares key terms before/after; scores `specificity_preserved`, `tech_forward_gain` (% of EMPHASIS_SKILLS newly bolded), `info_loss` (any key term dropped), `net_quality`.
- `rollUpResumeQuality()` — fail on `resume_gen_failed` or any `info_loss`; warning on lint flags or `resume_attribution_overrun`; ok otherwise.
- `rollUpCoverQuality()` — fail on `cover_letter_gen_failed` or any banned phrase; warning if word count < 350.

---

## src/evals/batch-report.ts

**Purpose:** Aggregates per-job eval results from a batch directory into a summary file, and appends a trend row to the global eval history log.

**Exports / public interface:**

- `writeBatchReport(batchDir: string, repoRoot: string): string`
  - **What it does:** Finds all `meta.json` files in `batchDir`, reads the `evals` key from each, builds `BatchSummary`, writes `{batchDir}/evals-summary.json`, calls `appendTrendRow()`.
  - **Returns:** absolute path to `evals-summary.json`.
- `appendTrendRow(summary: BatchSummary, repoRoot: string): void`
  - **What it does:** Appends one JSONL line to `output/evals-history.jsonl`. Each row includes `batch_id`, `run_at`, `total`, `pass`, `warn`, `fail`, and `degraded_by_patch_prompt_sha` (a map from `PATCH_PROMPT_SHA` → count of degraded emphasis ops, enabling cross-SHA quality trend comparison).

---

## scripts/eval/batch-evals.ts

**Purpose:** CLI wrapper for `writeBatchReport`. Runs against today's batch dir or a specified path.

**Usage:**

```bash
npx tsx scripts/eval/batch-evals.ts [batch-dir]
# Default: output/applications/{today}
```

**Key behavior:** Reads all `meta.json` files in the batch dir, aggregates eval results, writes `evals-summary.json`, appends trend row to `output/evals-history.jsonl`.

---

## scripts/eval/backfill-evals.ts

**Purpose:** Retroactively recomputes and overwrites the `evals` key in all `meta.json` files for a given batch. Uses the latest eval runner logic, so past results can be restated after logic improvements.

**Usage:**

```bash
npx tsx scripts/eval/backfill-evals.ts [batch-dir]
# Default: output/applications/{today}
```

**Key behavior:** Loads `config/resume_master.tex` as the canonical TeX source. For each `meta.json` found recursively: reads `resume.patch_ops`, `judge.tailoring_hints`, `judge.gap_directives`, `cover_letter.*` fields; calls `runEvals()`; overwrites the `evals` key. Skips if any field is missing with a warning. Then runs `writeBatchReport()` to produce `evals-summary.json`.

---

## src/resume-generator/patch/diff-lint.ts

**Purpose:** Post-apply lint for patch tailoring mode. Checks the patched LaTeX for quality and constraint violations before the result is accepted.

**Exports / public interface:**

- `runDiffLint(patchedTex: string, ops: PatchOp[], directives: GapDirective[], wordCountMin?: number, wordCountMax?: number): { violations: string[]; flags: string[] }`
  - **What it does:** Three checks in order: (1) for every `forbid` directive, verify that the term is absent from all inserted/rewritten bullets in the patched TeX; (2) scan every inserted/rewritten bullet for banned style phrases; (3) check total word count falls within `[wordCountMin, wordCountMax]` bounds when provided.
  - **Returns:** `violations` (human-readable descriptions of each failure) and `flags` (machine-readable strings like `patch_diff_lint_failed:<check>` appended to the result's warning list).
  - **Side effects:** none (pure).

---

## scripts/eval/export-fixtures.ts

**Purpose:** Query Postgres for STRONG/MAYBE jobs that have `gap_directives` and write them as eval fixtures for the offline replay harness.

**Exports / public interface:** None (script).

**Key behavior:**

- Gated on `EVAL_LIVE=1` env var; exits with a clear error if not set, to prevent accidental live DB use.
- Writes one JSON file per job to `fixtures/eval/jobs/{slug}.json`.
- Reports diversity stats (by source, verdict, number of directives) to stdout.

---

## scripts/eval/replay-resume.ts

**Purpose:** Deterministic replay runner for the eval harness. Loads eval fixtures and runs the resume generator in each configured mode, recording quality metrics.

**Exports / public interface:** None (script).

**Key behavior:**

- Gated on `EVAL_LIVE=1` env var.
- Loads fixtures from `fixtures/eval/jobs/`, runs each through modes `["patch_tailoring", "full_regen"]`.
- Records per-fixture: directive coverage, `ops_dropped`, banned phrase hits, forbid violations, input/output tokens.
- Emits `output/audits/eval-{timestamp}.md` (human-readable) and `output/audits/eval-{timestamp}.json` (machine-readable).

---

## scripts/eval/diff-reports.ts

**Purpose:** Diff two eval JSON reports (produced by `replay-resume.ts`) to compare quality across code changes.

**Exports / public interface:** None (script).

**Usage:**

```bash
npx tsx scripts/eval/diff-reports.ts output/audits/eval-OLD.json output/audits/eval-NEW.json
```

**Key behavior:**

- Produces a per-fixture per-check delta table.
- Emits summary: zero-op rate, mean coverage, banned total, compile fails, dropped total.

---

## scripts/eval/compare-models.ts

**Purpose:** Head-to-head model comparison for patch generation. Runs `generatePatchOps` twice per job (once per model using `modelOverride`), applies ops with `applyPatchOps`, evaluates with `runEvals`, and writes a JSON comparison report.

**Exports / public interface:** None (script).

**Usage:**

```bash
npx tsx scripts/eval/compare-models.ts [--limit N] [--jobs id1,id2,...]
```

Default limit: 30. Reads all applied-job `meta.json` files from `output/applications/`. Writes to `output/audits/compare-models-{timestamp}.json`.

**Key behavior:**

- Both models run against the same canonical TeX and judge context from persisted `meta.json`.
- Compares op counts, quality (ok/warning/fail), `info_loss_ops`, `dropped_phrases`, `tech_forward_gain`, and token usage per model.
- Prints a summary table: ok/warning/fail counts, total info_loss ops, avg tokens, error counts.

---

## scripts/storage/calibration-export.sql

**Purpose:** SQL query that exports all labeled jobs with score breakdown and judge verdict as a CSV, for tuning the 5 scoring weights against real ground-truth labels.

**Usage:**

```bash
psql $DATABASE_URL -f scripts/storage/calibration-export.sql -A -F',' > labels.csv
```

**What it returns:** One row per labeled job with columns: `job_id`, `title`, `company`, `source`, `score_total`, `skills`, `semantic`, `yoe`, `seniority`, `location`, `judge_verdict`, `judge_bucket`, `user_label`, `notes`, `labeled_at`. Ordered by `score_total DESC`.

**Used by:** Section 7.3 calibration workflow — this is the export step before weight tuning.
