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

**Exports / public interface:** `fetchJobPage`, `fetchJobPages`, `extractText`, `isAllowedByRobots`, `FetchResult`.

---

## src/fetcher/fetch.ts

**Purpose:** Fetch job pages and convert HTML to plain text; includes polite per-domain delays and Dice URL normalization.

**Exports / public interface:**

- `fetchJobPage(url: string): Promise<FetchResult>` (never throws; returns status)
- `fetchJobPages(urls: string[]): Promise<FetchResult[]>`
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

---

## src/judge/prompt.ts

**Purpose:** System prompt and input formatter for LLM judge.

**Exports / public interface:** `PROMPT_VERSION`, `SYSTEM_PROMPT`, `buildJudgePrompt(input)`.

---

## src/judge/validate.ts

**Purpose:** Zod validation and JSON parsing for judge responses.

**Exports / public interface:** `JudgeFieldsSchema`, `validateJudge(raw)`, `ValidatedJudgeFields`.

---

## src/judge/client.ts

**Purpose:** OpenRouter client for judge stage (JSON object mode).

**Exports / public interface:** `complete(opts)`, types.

---

## src/judge/judge.ts

**Purpose:** Judge orchestration (LLM call, retry, error wrapping) and bucket routing logic.

**Exports / public interface:** `judge(input, config)`, `getBucket(judgeResult, totalScore)`.

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

**Exports / public interface:** `connectRedis`, `disconnectRedis`, `isSeen`, `markSeen`, `markSeenBulk`.

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
- `--query` (Dice)
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

**Purpose:** LinkedIn scraping via `python-jobspy`, dedup across multiple queries.

**Public interface:** `scrape(max_jobs, run_id, location="...", hours_old=72, search_terms=None) -> Iterator[dict]`.

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

## scripts/storage/calibration-export.sql

**Purpose:** SQL query that exports all labeled jobs with score breakdown and judge verdict as a CSV, for tuning the 5 scoring weights against real ground-truth labels.

**Usage:**

```bash
psql $DATABASE_URL -f scripts/storage/calibration-export.sql -A -F',' > labels.csv
```

**What it returns:** One row per labeled job with columns: `job_id`, `title`, `company`, `source`, `score_total`, `skills`, `semantic`, `yoe`, `seniority`, `location`, `judge_verdict`, `judge_bucket`, `user_label`, `notes`, `labeled_at`. Ordered by `score_total DESC`.

**Used by:** Section 7.3 calibration workflow — this is the export step before weight tuning.

