# Project Documentation — job-hunter

> This documentation is generated from the codebase and `THE-BIBLE-v7.md` and is intended to be **self-contained**.
>
> If you are reading this with no prior context, start with “How to Run the App”, then “Architecture and Flow”.

## Table of Contents

- [1. Project Overview](#1-project-overview)
  - [1.1 What this project is](#11-what-this-project-is)
  - [1.2 Tech stack](#12-tech-stack)
  - [1.3 Repo layout](#13-repo-layout)
  - [1.4 Environment variables](#14-environment-variables)
- [2. How to Run the App](#2-how-to-run-the-app)
  - [2.1 Prerequisites](#21-prerequisites)
  - [2.2 First-time setup](#22-first-time-setup)
  - [2.3 Daily operation](#23-daily-operation)
  - [2.4 All available npm scripts](#24-all-available-npm-scripts)
  - [2.5 Python scraper commands](#25-python-scraper-commands)
  - [2.6 Database commands](#26-database-commands)
  - [2.7 Stopping and restarting](#27-stopping-and-restarting)
  - [2.8 Manual pipeline run modes](#28-manual-pipeline-run-modes-bypassing-the-orchestrator)
  - [2.9 Inspecting results after a run](#29-inspecting-results-after-a-run)
- [3. Architecture and Flow](#3-architecture-and-flow)
  - [3.1 High-level architecture diagram (ASCII)](#31-high-level-architecture-diagram-ascii)
  - [3.2 Pipeline flow — high level](#32-pipeline-flow--high-level)
  - [3.3 Pipeline flow — low level](#33-pipeline-flow--low-level)
  - [3.4 Orchestrator flow](#34-orchestrator-flow)
  - [3.5 Deduplication flow](#35-deduplication-flow)
  - [3.6 Scoring model](#36-scoring-model)
  - [3.7 Judge and bucketing](#37-judge-and-bucketing)
  - [3.8 Cover letter generation](#38-cover-letter-generation)
  - [3.9 UI flow](#39-ui-flow)
- **Deep reference docs**
  - [`docs/FILE-REFERENCE.md`](./FILE-REFERENCE.md) — Section 4 (every file + method reference)
  - [`docs/SCHEMA-REFERENCE.md`](./SCHEMA-REFERENCE.md) — Section 5 (database schema)
  - [`docs/OPERATIONS.md`](./OPERATIONS.md) — Sections 6–8 (config reference, ops guide, decision log)

---

## 1. Project Overview

### 1.1 What this project is

**High-level**

`job-hunter` is a single-user job-hunting automation system that scrapes job listings, filters them deterministically, optionally fetches job descriptions, uses LLMs to extract structured fields and judge fit, generates cover letters for the best matches, and persists everything for review and calibration.

It is designed for one laptop, one user, and unattended scheduled operation (cron-style). The output is (a) cover letters on disk and (b) a local Review UI to label and track application actions.

**Deploy story**

```bash
git pull
npm install
npm start
```

**What the output looks like**

- **Cover letters (on disk)**: `output/cover-letters/{run_id}/COVER_LETTER/*.md` and `output/cover-letters/{run_id}/REVIEW_QUEUE/*.md`
- **Logs**:
  - `output/logs/orchestrator.log` (scheduler + runner + health warnings)
  - `output/logs/reaper.log` (ghost run cleanup)
  - `output/logs/runs/{run_id}.log` (child pipeline stdout/stderr)
- **Database records**: Postgres tables (`runs`, `jobs`, `scores`, `judge_verdicts`, `cover_letters`, `labels`, etc.)
- **Review UI** (local): served by Express on **`http://localhost:3001`** (default port is occupied on the dev machine)

---

### 1.2 Tech stack

**Low-level**

| Layer | Choice | Where | Notes |
|---|---|---|---|
| Runtime | Node.js + TypeScript (ESM) | `package.json`, `tsconfig.json` | Root package runs orchestrator + pipeline scripts via `tsx` |
| Scheduler | `node-cron` | `src/orchestrator/scheduler.ts` | Hardcoded schedules; includes ghost reaper tick |
| Web API server (UI) | Express **v5** | `scripts/ui-server.ts` | Serves SPA build + `/api/*` endpoints; SPA fallback via `app.use(...)` (Express 5-safe) |
| UI | Vite + React + TS | `ui/` | Dev server proxies `/api` → `http://localhost:3001` |
| Storage | Postgres 16 + `pgvector` | `docker-compose.yml`, `migrations/*.sql` | Vector index (HNSW) for semantic dedup |
| Ephemeral store | Redis 7 | `docker-compose.yml` | Exact dedup (`seen:*`) and orchestrator locks (`orchestrator:lock:*`) |
| LLM provider | OpenRouter | `src/extractor/*`, `src/judge/*`, `src/cover-letter/*` | Raw fetch clients; extractor uses strict `json_schema` mode |
| Embeddings | Local `bge-small-en-v1.5` via `@huggingface/transformers` | `src/scorer/embed.ts` | 384-dim, q8; cached; semantic score component best-effort |
| Tests | Vitest | `test/`, `src/storage/test/` | Infra tests gated by `RUN_INFRA_TESTS=1` |
| Python scrapers | Playwright + bs4 + jobspy | `scraper/` | Dice is public; Jobright needs session cookies; LinkedIn uses JobSpy |

---

### 1.3 Repo layout

**Low-level**

Annotated tree (key paths only):

```
.
├── config/
│   ├── config.json                # LLM models + throttles + scoring weights/thresholds
│   ├── profile.json               # user profile (authoritative)
│   ├── skills.json                # skill aliases + years/confidence (authoritative for profile.skills)
│   ├── resume.tex                 # optional; used to ground cover letters
│   └── cookies/                   # gitignored; browser session cookies (Jobright)
├── migrations/
│   ├── 001_initial.sql            # core schema + pgvector extension/index
│   ├── 002_orchestrator.sql       # run supervision columns (heartbeat/exit_code/extraction counts)
│   ├── 003_labels.sql             # labels table for calibration
│   └── 004_ui_application_tracking.sql  # application_status + applied_at
├── scripts/
│   ├── run-pipeline.ts            # main 19-stage pipeline runner
│   ├── ui-server.ts               # Express 5 API + static UI server (port 3001)
│   └── sort-log.ts                # utility to sort pipeline logs
├── src/
│   ├── orchestrator/              # scheduler + lock + runner + monitor + one-shot trigger
│   ├── filter/                    # sanitize + hard filter + post-fetch checks + config loader
│   ├── fetcher/                   # HTML fetch + strip to plain text
│   ├── extractor/                 # OpenRouter extraction client + schema + validate + retry
│   ├── scorer/                    # deterministic scoring + local embeddings
│   ├── judge/                     # OpenRouter judge client + routing to buckets
│   ├── cover-letter/              # cover letter prompts + generation + save to disk
│   ├── dedup/                     # Redis exact dedup + pgvector semantic dedup
│   └── storage/                   # Postgres persistence, migrations runner, integrity check
├── ui/
│   └── src/                       # React SPA tabs/components; dev server proxies /api → :3001
├── scraper/                       # Python scrapers (dice, jobright_api, jobright fallback, linkedin jobspy)
├── fixtures/                      # test fixtures (filter/extractor/judge)
└── test/                          # Vitest tests for all TS modules
```

---

### 1.4 Environment variables

**Low-level**

The pipeline and orchestrator are configured almost entirely via environment variables.

> Notes:
> - `.env` lives at repo root and is loaded by `scripts/run-pipeline.ts` using `dotenv`.
> - Orchestrator (`npm start`) inherits shell env; it does not auto-load `.env` unless you load it in your shell.

| Variable | Required? | Used by | Example | Meaning |
|---|---:|---|---|---|
| `OPENROUTER_API_KEY` | **Yes for EXTRACT/JUDGE/COVER** | extractor/judge/cover-letter clients | `sk-or-...` | OpenRouter API key |
| `DATABASE_URL` | Recommended | storage + orchestrator + ui-server | `postgresql://postgres:postgres@localhost:5432/jobhunter` | Postgres connection string |
| `REDIS_URL` | Recommended | dedup + orchestrator lock | `redis://localhost:6379` | Redis connection string |
| `OUTPUT_DIR` | Optional | orchestrator monitor/logging | `output` | Base output dir for orchestrator logs |
| `PROJECT_ROOT` | Optional | orchestrator runner | `/path/to/jobs` | Working dir used when spawning the pipeline |
| `SOURCE` | Optional | pipeline + orchestrator trigger | `dice` | Job source: `dice`, `jobright_api`, `jobright`, `linkedin` |
| `MAX` | Optional | pipeline + orchestrator trigger | `20` | Max jobs to scrape/process per run |
| `HEADED` | Optional | pipeline → scraper subprocess | `1` | Show Playwright browser for Playwright scrapers |
| `JSONL` | Optional | pipeline | `scraper/output/dice_<run>.jsonl` | Replay an existing JSONL file (skip scrape) |
| `EXTRACT` | Optional | pipeline | `1` | Enable LLM extraction (also enables score/judge/cover unless explicitly disabled) |
| `SCORE` | Optional | pipeline | `1` | Enable deterministic scoring |
| `JUDGE` | Optional | pipeline | `1` | Enable LLM judge |
| `COVER` | Optional | pipeline | `1` | Enable cover letter generation |
| `SAVE_FIXTURES` | Optional | pipeline extractor stage | `1` | Save up to 5 successful real extraction fixtures to `fixtures/extractor/` |
| `SKIP_DEDUP` | Optional | pipeline | `1` | Disable Redis + pgvector dedup |
| `SKIP_PERSIST` | Optional | pipeline | `1` | Disable Postgres persistence |
| `QUERY` | Optional (Dice only) | pipeline → scraper | `java developer` | Dice search query |
| `POSTED_WITHIN` | Optional (Dice only) | pipeline → scraper | `ONE` | Dice recency filter (`ONE`, `THREE`, `SEVEN`) |
| `VERIFY` | Optional | pipeline | `1` | Run integrity check at end (Redis ↔ Postgres seen-state) |
| `RUN_ID` | Optional | pipeline (set by orchestrator) | `manual-...` | Force pipeline to use a specific `run_id` |
| `DEBUG_EXTRACT` | Optional | extractor | `1` | Print raw model response preview when extraction validation fails |
| `EXTRACTOR_FORCE_JSON_OBJECT` | Optional | extractor client | `1` | Force OpenRouter `response_format` to `json_object` instead of strict `json_schema` |
| `RUN_INFRA_TESTS` | Optional | tests | `1` | Enable tests that require real Redis/Postgres |
| `RUN_DB_DOWN_TESTS` | Optional | storage tests | `1` | Enable slow tests that simulate DB connection failures |

---

## 2. How to Run the App

### 2.1 Prerequisites

**High-level**

You need Node for the TypeScript runtime, Python for scrapers, and Docker for local Postgres/Redis.

**Low-level**

- **Node.js**: v22+ recommended (project uses modern ESM and Node features)
- **npm**: v10+ recommended
- **Python**: 3.11+
- **Docker + Docker Compose**

---

### 2.2 First-time setup

**High-level**

Bring up Postgres/Redis, install Node deps, install Python scraper deps, create `.env`, run migrations, then run the orchestrator and/or pipeline.

**Low-level (copy/paste)**

```bash
# 1) Start local services
docker compose up -d
docker compose ps

# 2) Install Node deps + run tests
npm install
npm test

# 3) Create .env at repo root (minimum viable)
cat > .env <<'EOF'
OPENROUTER_API_KEY=sk-or-REPLACE_ME
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/jobhunter
REDIS_URL=redis://localhost:6379
EOF

# 4) Run migrations (idempotent)
npx tsx src/storage/migrate.ts

# 5) Python scraper setup (first time only)
cd scraper
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
cd ..
```

**Cookies (Jobright only)**

- Export Jobright session cookies to `config/cookies/jobright_api.json` (never commit).
- `dice` does not require cookies; `linkedin` uses JobSpy (no cookies).

---

### 2.3 Daily operation

**High-level**

Run the orchestrator for unattended scheduled runs. Use the one-shot trigger for manual smoke tests. Use the UI server to review and label jobs.

**Low-level**

Start orchestrator (runs forever):

```bash
npm start
```

Watch logs:

```bash
tail -f output/logs/orchestrator.log
tail -f output/logs/reaper.log
```

Trigger a manual run immediately (without waiting for cron):

```bash
npx tsx src/orchestrator/trigger-once.ts
```

Watch a specific run’s child log:

```bash
tail -f output/logs/runs/<run_id>.log
```

Start the Review UI API server (production mode: serves built UI):

```bash
npx tsx scripts/ui-server.ts
# -> [ui-server] listening on http://localhost:3001
```

Dev mode UI (hot reload; proxies `/api` to `:3001`):

```bash
cd ui
npm install
npm run dev
# -> http://localhost:5173
```

Build the UI for production serving:

```bash
cd ui
npm install
npm run build
cd ..
```

---

### 2.4 All available npm scripts

From root `package.json`:

| Script | Command | What it does | When to use |
|---|---|---|---|
| `start` | `npm start` | Run orchestrator (`tsx src/orchestrator/index.ts`) | Unattended scheduled operation |
| `pipeline` | `npm run pipeline` | Run pipeline once (`tsx scripts/run-pipeline.ts`) | Manual runs / debugging |
| `test` | `npm test` | Run Vitest test suite | Before committing / verifying behavior |
| `test:watch` | `npm run test:watch` | Vitest in watch mode | Iterating locally |
| `test:infra` | `npm run test:infra` | Infra tests (`RUN_INFRA_TESTS=1 vitest run`) | When Redis/Postgres are up |
| `build` | `npm run build` | Typecheck (`tsc --noEmit`) | CI-like compile check |

---

### 2.5 Python scraper commands

Activate venv:

```bash
cd scraper
source .venv/bin/activate
```

Run scrapers directly:

```bash
# Dice (public)
python -m scraper --source dice --max 50 --query "java developer" --posted-within ONE

# Jobright API (requires SESSION_ID cookie file at config/cookies/jobright_api.json)
python -m scraper --source jobright_api --max 40

# Jobright HTML fallback (requires cookies; fragile selectors)
python -m scraper --source jobright --max 50 --headed

# LinkedIn via JobSpy
python -m scraper --source linkedin --max 30 --hours-old 72
```

What scrapers output:

- `scraper/output/{source}_{run_id}.jsonl` (newline-delimited JSON)

---

### 2.6 Database commands

Run migrations (idempotent):

```bash
npx tsx src/storage/migrate.ts
```

Connect to Postgres:

```bash
psql "$DATABASE_URL"
```

Useful debug queries:

```sql
-- Latest runs
SELECT run_id, source, started_at, finished_at, exit_code,
       jobs_total, jobs_passed, jobs_gated, jobs_covered,
       extractions_attempted, extractions_succeeded
FROM runs
ORDER BY started_at DESC
LIMIT 10;

-- Latest APPLY QUEUE jobs (buckets that show in UI)
SELECT j.scraped_at, j.title, j.company, s.total, jv.verdict, jv.bucket
FROM jobs j
JOIN scores s ON s.job_id=j.job_id AND s.run_id=j.run_id
JOIN judge_verdicts jv ON jv.job_id=j.job_id AND jv.run_id=j.run_id
WHERE jv.bucket IN ('COVER_LETTER','REVIEW_QUEUE','RESULTS')
ORDER BY j.scraped_at DESC
LIMIT 50;

-- Label distribution
SELECT label, COUNT(*) FROM labels GROUP BY label ORDER BY COUNT(*) DESC;

-- Application status counts
SELECT application_status, COUNT(*) FROM labels GROUP BY application_status ORDER BY COUNT(*) DESC;

-- Cover letter paths (content is typically NULL; server reads from file_path)
SELECT job_id, run_id, file_path, word_count, model
FROM cover_letters
ORDER BY generated_at DESC
LIMIT 20;

-- Ghost runs (unfinished)
SELECT run_id, source, started_at, last_heartbeat
FROM runs
WHERE finished_at IS NULL
ORDER BY started_at DESC;
```

---

### 2.7 Stopping and restarting

Stop orchestrator cleanly:

- Press `Ctrl+C` in the terminal running `npm start` (SIGINT).
- Or send SIGTERM (e.g., via process manager). The orchestrator stops scheduling new ticks; the runner forwards SIGTERM to a running pipeline child and waits up to 30s before SIGKILL.

Restart after code change:

```bash
# stop with Ctrl+C, then:
npm start
```

---

### 2.8 Manual pipeline run modes (bypassing the orchestrator)

Run `scripts/run-pipeline.ts` directly with env vars to control exactly what happens. All commands below are run from the repo root.

**Standard fresh run — Dice, last 1 day:**
```bash
SOURCE=dice MAX=20 POSTED_WITHIN=ONE EXTRACT=1 \
  npx tsx scripts/run-pipeline.ts
```

**Backfill — last 7 days, higher cap:**
```bash
SOURCE=dice MAX=100 POSTED_WITHIN=SEVEN EXTRACT=1 \
  npx tsx scripts/run-pipeline.ts
```

**Jobright API:**
```bash
SOURCE=jobright_api MAX=40 EXTRACT=1 \
  npx tsx scripts/run-pipeline.ts
```

**LinkedIn:**
```bash
SOURCE=linkedin MAX=30 EXTRACT=1 \
  npx tsx scripts/run-pipeline.ts
```

**Skip dedup — force re-process jobs already seen (useful for testing):**
```bash
SOURCE=dice MAX=5 EXTRACT=1 SKIP_DEDUP=1 \
  npx tsx scripts/run-pipeline.ts
```

**Skip persistence — dry run with no DB writes:**
```bash
SOURCE=dice MAX=5 EXTRACT=1 SKIP_PERSIST=1 \
  npx tsx scripts/run-pipeline.ts
```

**Replay an existing JSONL — no scrape, no Python, no API cost:**
```bash
JSONL=scraper/output/dice_<run_id>.jsonl EXTRACT=1 \
  npx tsx scripts/run-pipeline.ts
```
Use this to re-run the full pipeline on a previous scrape output after changing the scorer, judge prompt, or cover letter prompt.

**Filter-only run — no LLM calls at all:**
```bash
SOURCE=dice MAX=20 \
  npx tsx scripts/run-pipeline.ts
# EXTRACT defaults to 0 when not set — only scrape + filter runs
```

**Save extraction fixtures (caps at 5 total across all runs):**
```bash
SOURCE=dice MAX=20 EXTRACT=1 SAVE_FIXTURES=1 \
  npx tsx scripts/run-pipeline.ts
```

**Run Redis ↔ Postgres integrity check at end:**
```bash
SOURCE=dice MAX=20 EXTRACT=1 VERIFY=1 \
  npx tsx scripts/run-pipeline.ts
```

**Debug extraction failures — print raw model response on validation error:**
```bash
SOURCE=dice MAX=5 EXTRACT=1 DEBUG_EXTRACT=1 \
  npx tsx scripts/run-pipeline.ts
```

**Headed scraper — show the Playwright browser window (Jobright):**
```bash
SOURCE=jobright_api MAX=10 EXTRACT=1 HEADED=1 \
  npx tsx scripts/run-pipeline.ts
```

---

### 2.9 Inspecting results after a run

```bash
# Cover letters — list most recent run folder
ls -lt output/cover-letters/ | head -3
ls output/cover-letters/<run_id>/COVER_LETTER/
ls output/cover-letters/<run_id>/REVIEW_QUEUE/

# Orchestrator health — last 20 lines
tail -20 output/logs/orchestrator.log

# Postgres — last 10 runs with key stats
psql $DATABASE_URL -c "
  SELECT run_id, source, jobs_total, jobs_passed, jobs_covered,
         extractions_attempted, extractions_succeeded,
         exit_code, last_heartbeat, finished_at
  FROM runs
  ORDER BY started_at DESC
  LIMIT 10;
"

# Postgres — verdicts and cover letter paths for latest run
psql $DATABASE_URL -c "
  SELECT j.title, j.company, jv.verdict, jv.bucket, cl.file_path
  FROM jobs j
  LEFT JOIN judge_verdicts jv ON jv.job_id = j.job_id AND jv.run_id = j.run_id
  LEFT JOIN cover_letters cl  ON cl.job_id = j.job_id AND cl.run_id = j.run_id
  ORDER BY j.scraped_at DESC
  LIMIT 20;
"

# Redis — how many Dice jobs have been seen (exact dedup state)
redis-cli --scan --pattern 'seen:dice:*' | wc -l

# Redis — check for active orchestrator locks (should be empty when idle)
redis-cli --scan --pattern 'orchestrator:lock:*'
```

---

## 3. Architecture and Flow

### 3.1 High-level architecture diagram (ASCII)

```
                 ┌────────────────────────────────────────────────────┐
                 │                    Orchestrator                     │
                 │   node-cron schedules + Redis lock + runner + logs  │
                 │        src/orchestrator/{scheduler,runner,...}      │
                 └───────────────┬────────────────────────────────────┘
                                 │ spawn child (RUN_ID set)
                                 v
┌─────────────────┐     ┌───────────────────────────────────────────────┐
│  Python Scraper │     │            Node Pipeline (run-pipeline)         │
│  scraper/*.py   │ --> │ scripts/run-pipeline.ts (19-stage main flow)    │
└─────────────────┘     ├───────────────┬───────────────────────────────┤
                        │               │
                        v               v
                  ┌───────────┐   ┌───────────┐
                  │   Redis   │   │  Postgres  │
                  │ exact ded │   │ runs/jobs… │
                  │ + locks   │   │ + pgvector │
                  └───────────┘   └───────────┘
                                      ^
                                      │
                           ┌──────────┴──────────┐
                           │     UI Server        │
                           │ scripts/ui-server.ts │
                           │  Express 5, :3001    │
                           └──────────┬──────────┘
                                      │ /api/*
                                      v
                           ┌──────────────────────┐
                           │      React SPA       │
                           │        ui/src        │
                           └──────────────────────┘
```

---

### 3.2 Pipeline flow — high level

The pipeline is a single process (`scripts/run-pipeline.ts`) that runs a staged flow per job. Some stages run for every job; expensive stages run only for PASS jobs.

Stages (high level):

1. **Run init**: load `.env`, profile, skill aliases, config; determine `RUN_ID`.
2. **Storage init**: run migrations; create run record (best-effort).
3. **Dedup init**: connect to Redis (best-effort).
4. **Profile embedding**: compute one profile embedding if scoring enabled.
5. **Scrape**: run Python scraper; produce `scraper/output/{source}_{run_id}.jsonl`.
6. **Sanitize**: normalize any suspicious fields.
7. **Hard filter**: deterministic reject/pass + flags.
8. **Cross-run exact dedup**: Redis `seen:{source}:{job_id}` gate.
9. **Fetch**: fetch JD HTML and extract plain text (skipped when scraper already provides prose).
10. **Post-fetch checks**: staleness + education regex recovery flagging.
11. **LLM extract**: extract structured fields (skills/YOE/education/domain/concerns) with strict JSON schema.
12. **Skill normalization**: canonicalize skill names through alias map.
13. **Score**: deterministic 5-component score; apply gate threshold (default 0.50 from `config/config.json`).
14. **Semantic dedup**: pgvector cosine check to avoid cross-site duplicates.
15. **LLM judge**: verdict STRONG/MAYBE/WEAK.
16. **Bucket routing**: COVER_LETTER / RESULTS / REVIEW_QUEUE / ARCHIVE.
17. **Cover letter generation**: for COVER_LETTER and some REVIEW_QUEUE jobs; write to disk.
18. **Persist**: write DB records for jobs, filter_results, scores, judge_verdicts, cover_letters, seen_jobs; mark Redis seen.
19. **Finish run**: update run stats, extraction attempt/success counts.

Failure behavior:

- Most modules are intentionally **non-throwing**; the pipeline prefers to finish a run and write logs rather than crash.
- When Postgres or Redis are down, those subsystems are disabled and the run continues (disk output becomes the source of truth).

---

### 3.3 Pipeline flow — low level

This section gives the concrete “where and how” for each stage: file/function, parameters, data passed, and side effects.

> For full function-by-function documentation of every exported symbol, see [`docs/FILE-REFERENCE.md`](./FILE-REFERENCE.md).

#### Stage 0 — Run init

- **Entry point**: `scripts/run-pipeline.ts` → `main()`
- **Inputs**:
  - `config/profile.json`
  - `config/skills.json`
  - `config/config.json`
  - optional `config/resume.tex` (or `resume.md`)
  - `.env` (repo root)
- **Key env vars**: `RUN_ID`, `SOURCE`, `MAX`, `EXTRACT`, `SCORE`, `JUDGE`, `COVER`, `QUERY`, `POSTED_WITHIN`, `SAVE_FIXTURES`, `SKIP_DEDUP`, `SKIP_PERSIST`
- **Output**: in-memory config objects; `RUN_ID` string

#### Stage 1 — Storage init

- **Where**:
  - migrations runner: `src/storage/migrate.ts` → `runMigrations()`
  - run record: `src/storage/persist.ts` → `saveRun()`
- **Side effects**: Postgres schema updated (idempotent) and `runs` row inserted.
- **Failure mode**: on connect/query failure, pipeline logs and continues (persistence disabled).

#### Stage 2 — Dedup init (Redis)

- **Where**: `src/dedup/redis.ts` → `connectRedis()`
- **Side effects**: redis client connects and pings.
- **Failure mode**: marks `_connectionFailed` and dedup becomes a no-op.

#### Stage 3 — Profile embedding

- **Where**: `src/scorer/embed.ts` → `embedProfile()`
- **Data**: embedding `Float32Array(384)`
- **Side effects**: loads model once per machine/process; caches embeddings by hash.

#### Stage 4 — Scrape

- **Where**: `scripts/run-pipeline.ts` → `runScraper()` (subprocess `python -m scraper ...`)
- **Inputs**: `SOURCE`, `MAX`, `HEADED`, `QUERY`, `POSTED_WITHIN`
- **Output**: JSONL path `scraper/output/{source}_{run_id}.jsonl`

#### Stage 5 — Sanitize

- **Where**: `src/filter/sanitize.ts` → `sanitizeJob()`
- **Behavior**: deep clones the job and normalizes fields (currently `source_score` range validation).

#### Stage 6 — Hard filter

- **Where**: `src/filter/filter.ts` → `hardFilter(job, profile)`
- **Outputs**: `{ verdict: PASS|REJECT, reason, flags[] }`
- **Important**: **pure** (tests enforce non-mutation).

#### Stage 7 — Cross-run exact dedup (Redis)

- **Where**: `scripts/run-pipeline.ts` calls `src/dedup/redis.ts` → `isSeen(source, jobId)`
- **Key**: `seen:{source}:{job_id}` with TTL ~7 days
- **Effect**: DEDUP jobs skip fetch/extract/judge/cover.

#### Stage 8 — Fetch JD

- **Where**: `src/fetcher/fetch.ts` → `fetchJobPage(url)`
- **Note**: for sources like `jobright_api`, `description_raw` is synthesized at scrape time; pipeline skips fetch if pre-scraped description is “substantive” (>= 200 chars).

#### Stage 9 — Post-fetch checks

- **Where**: `src/filter/post-fetch.ts` → `postFetchChecks(job, nowIso)`
- **Adds flags**: `education_unparsed`, `posted_at_missing`, `stale_posting`

#### Stage 10 — LLM extract

- **Where**:
  - prompt: `src/extractor/prompt.ts`
  - client: `src/extractor/client.ts` (strict `json_schema` by default)
  - validate: `src/extractor/validate.ts` (Zod)
  - main: `src/extractor/extract.ts` → `extract(descriptionRaw, config)`
- **Output**: `ExtractionResult` with `fields` (or `error`)
- **Special**: quote substring verification (`verifyCitations`)

#### Stage 11 — Skill normalization

- **Where**: `src/filter/skills.ts` → `normalizeSkill(name, aliases)`
- **Inputs**: alias map built at pipeline start from `config/skills.json`.

#### Stage 12 — Score + gate

- **Where**:
  - components: `src/scorer/components.ts`
  - composite: `src/scorer/score.ts` → `scoreJob(...)`
- **Weights + threshold**:
  - from `config/config.json`:
    - weights: skills 0.35, semantic 0.25, yoe 0.15, seniority 0.15, location 0.10
    - gate threshold: 0.50
- **Output**: `ScoreResult` with `gate_passed`.

#### Stage 12.5 — Semantic dedup (pgvector)

- **Where**: `src/dedup/pgvector.ts` → `findSemanticDuplicate(embedding, currentRunId, threshold=0.88, lookbackDays=7)`
- **Effect**: duplicates forced to ARCHIVE with `semantic_duplicate` flag.

#### Stage 13 — LLM judge

- **Where**:
  - prompt: `src/judge/prompt.ts`
  - client: `src/judge/client.ts` (JSON object mode)
  - validate: `src/judge/validate.ts`
  - main: `src/judge/judge.ts` → `judge(input, config)`
- **Input**: structured job fields + score breakdown (not raw JD text)
- **Output**: STRONG / MAYBE / WEAK + reasoning + concerns[].

#### Stage 14 — Bucket routing

- **Where**: `src/judge/judge.ts` → `getBucket(judgeResult, totalScore)`
- **Rules**:
  - STRONG + score ≥ 0.70 → `COVER_LETTER`
  - STRONG + score < 0.70 → `RESULTS`
  - MAYBE → `REVIEW_QUEUE`
  - WEAK or judge error → `ARCHIVE`

#### Stage 15 — Cover letter generation + save

- **Where**:
  - prompt rules: `src/cover-letter/prompt.ts`
  - LLM client: `src/cover-letter/client.ts`
  - generator: `src/cover-letter/generate.ts`
  - resume loader: `src/cover-letter/resume.ts`
- **When**:
  - Always for bucket `COVER_LETTER`
  - Also for `REVIEW_QUEUE` jobs with score ≥ `llm.cover_letter.review_queue_threshold` (default 0.60)
- **Output**: file `output/cover-letters/{run_id}/{bucketLabel}/{slug}_{job_id_prefix}.md`

#### Stage 16–19 — Persist + finish

- **Where**:
  - `src/storage/persist.ts` → `saveJob(...)`, `finishRun(...)`
  - Redis seen marker: `src/dedup/redis.ts` → `markSeen(...)`
- **Tables written**: `jobs`, `filter_results`, `scores`, `judge_verdicts`, `cover_letters`, `seen_jobs`, `runs`

---

### 3.4 Orchestrator flow

**High-level**

The orchestrator runs on a schedule, prevents overlapping runs per source using a Redis lock, spawns the pipeline as a child process, writes logs, updates a heartbeat in Postgres, and performs post-run health checks. A ghost reaper task marks dead runs terminal and releases locks.

**Low-level**

- **Entry point**: `npm start` → `src/orchestrator/index.ts`
- **Schedules**: `src/orchestrator/scheduler.ts` (single source of truth)
- **Overlap prevention**: `src/orchestrator/lock.ts` uses Redis `SET NX EX` with key `orchestrator:lock:{source}`
- **Child spawn**: `src/orchestrator/runner.ts` runs:
  - `npx tsx scripts/run-pipeline.ts`
  - with env: `EXTRACT=1 SCORE=1 JUDGE=1 COVER=1 RUN_ID=<runId> SOURCE=<source> MAX=<max> POSTED_WITHIN=<...>`
- **Heartbeat**: `runner.ts` updates `runs.last_heartbeat = NOW()` every 60s via inline SQL
- **Exit code tracking**: `runner.ts` writes `runs.exit_code`
- **Logs**:
  - orchestrator: `src/orchestrator/monitor.ts` appends to `output/logs/orchestrator.log`
  - per-run: `output/logs/runs/{run_id}.log` captures child stdout/stderr
- **Monitor checks**: `src/orchestrator/monitor.ts` → `checkRun()` warns on:
  - 0 jobs scraped
  - low extraction success rate (with guard attempted > 5)
  - jobs passed but no cover letters
- **Ghost reaper**: `scheduler.ts` runs every 10 minutes; marks stale heartbeat runs as `exit_code=-1` and sets `finished_at`, then releases lock.

---

### 3.5 Deduplication flow

**High-level**

Two-phase dedup prevents repeated work:

- **Exact cross-run dedup (Redis)**: skip job IDs already processed recently.
- **Semantic cross-site dedup (pgvector)**: skip jobs that are textually/semantically near-duplicates across sources.

**Low-level**

1. **Redis exact dedup** (`src/dedup/redis.ts`)
   - Key: `seen:{source}:{job_id}`
   - TTL: 7 days
   - Called in pipeline after hard filter (so we don’t store rejects as seen).
2. **pgvector semantic dedup** (`src/dedup/pgvector.ts`)
   - Query `jobs.embedding` cosine similarity
   - Default threshold: 0.88
   - Lookback: 7 days
   - Only for `GATE_PASS` jobs with embedding, prior to judge (saves LLM calls).

---

### 3.6 Scoring model

**High-level**

The scorer produces a deterministic \(0..1\) score from five components and uses a gate threshold to decide which jobs are worth paying LLM costs for.

**Low-level**

Weights (from `config/config.json`):

| Component | Weight | File | Summary |
|---|---:|---|---|
| skills | 0.35 | `src/scorer/components.ts` | weighted skill overlap; thin-extraction ceiling |
| semantic | 0.25 | `src/scorer/components.ts` | cosine similarity of embeddings |
| yoe | 0.15 | `src/scorer/components.ts` | asymmetric under/over qualification |
| seniority | 0.15 | `src/scorer/components.ts` | ordinal distance from acceptable range |
| location | 0.10 | `src/scorer/components.ts` | type/city/country compatibility |

Gate threshold (from `config/config.json`): **0.50**

---

### 3.7 Judge and bucketing

**High-level**

The judge is an LLM that makes the final apply/no-apply decision using structured job fields plus the score breakdown. Routing turns that decision into one of four “buckets” used for output + UI.

**Low-level**

- **Judge output**: `STRONG | MAYBE | WEAK` plus `reasoning` and `concerns[]`
- **Bucket mapping** (`src/judge/judge.ts`):
  - STRONG + score ≥ 0.70 → `COVER_LETTER`
  - STRONG + score < 0.70 → `RESULTS`
  - MAYBE → `REVIEW_QUEUE`
  - WEAK or judge error → `ARCHIVE`

---

### 3.8 Cover letter generation

**High-level**

Cover letters are generated by an LLM and written to disk. The database’s `cover_letters.file_path` points to the file; `cover_letters.content` is commonly NULL (by design; the UI server reads from disk).

**Low-level**

- **Generator**: `src/cover-letter/generate.ts` → `generateCoverLetter()` then `saveCoverLetter()`
- **Prompt rules**: `src/cover-letter/prompt.ts` (strict style constraints, gap acknowledgment rules)
- **Output paths**:
  - `output/cover-letters/{run_id}/COVER_LETTER/*.md`
  - `output/cover-letters/{run_id}/REVIEW_QUEUE/*.md`

---

### 3.9 UI flow

**High-level**

The Review UI is a local SPA that supports daily workflow:

1) Review the Apply Queue (best jobs) and mark Applied / Apply Later / Not Applied.
2) Review hard rejections (deterministic rejects) to catch false negatives.
3) Review soft rejections (ARCHIVE) to catch judge/score false negatives.

Labels and application actions are persisted in `labels` and are the foundation for future scoring calibration.

**Low-level**

- **Server**: `scripts/ui-server.ts` (Express 5) listens on **3001** and exposes only:
  - `GET /api/apply-queue`
  - `GET /api/rejections-hard`
  - `GET /api/rejections-soft`
  - `GET /api/stats` → returns **5 keys**: `{ pending, applyLater, applied, hardRejectionsUnreviewed, softRejectionsUnreviewed }`
  - `POST /api/label` (upsert into `labels`)
- **Cover letter loading**: if `cover_letters.content` is null, the server reads from `cover_letters.file_path` on disk, and tries a historical path substitution (`/Downloads/project/` → `/Downloads/jobs/`) for older rows.
- **SPA fallback**: `app.use((req,res)=>res.sendFile(...))` (Express 5-safe).
- **Frontend**:
  - `ui/src/App.tsx`: tabs + stats header
  - `ui/src/tabs/ApplyQueue.tsx`: main workflow list
  - `ui/src/components/JobCard.tsx`: shared card renderer with per-tab mode
  - Filters: Pending/Applied/Not Applied/Apply Later behavior is driven by `labels.application_status`

---

## Next: Deep reference docs

- [`docs/FILE-REFERENCE.md`](./FILE-REFERENCE.md)
- [`docs/SCHEMA-REFERENCE.md`](./SCHEMA-REFERENCE.md)
- [`docs/OPERATIONS.md`](./OPERATIONS.md)

