# THE BIBLE — v6 (2026-04-25)

> Project: **job-hunter** — automated job discovery + filter + score + judge + cover letter pipeline for Sarath Konuru.
>
> This is the authoritative document. Supersedes v5 (2026-04-25), which superseded v4 (2026-04-23), v3 (2026-04-20), v2 (2026-04-18), and v1 (2026-04-17).
>
> Read this before writing code. Update this file when module status changes.

---

## 1. What changed since v5

Three waves of work landed between v5 and v6.

**Wave 1 — Orchestrator design and architecture decision.** v1 originally specified BullMQ per-stage queues (scrape → filter → fetch → extract → score → judge → cover-letter each as a separate queue). After a full three-option analysis (BullMQ per stage vs run-level orchestration vs no orchestrator at all), the decision was made to build **Option 2.5 — run-level orchestration with hardening additions**. BullMQ per stage was rejected because it would require serializing `Float32Array(384)` embeddings through Redis between every stage, break the `run_id` model the entire Postgres schema is built around, and rewrite 232 passing tests' worth of working pipeline logic — all to solve concurrency problems that `pLimit(5)` and `throttle_ms` already handle. No orchestrator was rejected because it has no overlap prevention, leaving the Sunday backfill + Monday tick race condition unsolved, and no failure visibility, contradicting the v5 exit criterion of "no silent failures."

**Wave 2 — Storage v5.1 changes.** The orchestrator required four new columns on the `runs` table: `exit_code`, `last_heartbeat`, `extractions_attempted`, `extractions_succeeded`. These are written by the orchestrator runner (exit code, heartbeat) and derived at `finishRun` time from `JobResult.extract_status` (extraction counts). `RunStats` type updated, `finishRun` SQL updated, four new functions added to `persist.ts`: `updateHeartbeat`, `markRunExitCode`, `getUnfinishedRuns`, `getRunStats`. `run-pipeline.ts` updated with two new derived counts at the `finishRun` call site and `RUN_ID` read from `process.env` so the orchestrator and pipeline share the same run identifier.

**Wave 3 — Orchestrator built, tested, and verified end-to-end.** The `orchestrator/` module was built and all three test files pass. A real end-to-end run was executed against live Dice via `trigger-once.ts`: 10 jobs scraped, dedup correctly fired on a second run (9/9 seen), full extraction → scoring → judge → cover letter path verified with a fixed OpenRouter key (4/4 extractions succeeded, 2 STRONG → COVER_LETTER, 2 MAYBE → REVIEW_QUEUE, 4 cover letters written). Monitor correctly caught 0% extraction rate from the first run (bad API key) and emitted a warning. Ghost reaper tests confirmed against real Postgres. The pipeline now runs unattended.

---

## 2. North star

Unchanged from v1. This is a personal job-hunting automation for one user (Sarath), running on a single laptop, scheduled four times per day. No multi-tenant concerns, no auth, no cloud orchestration.

**Updated deploy story:** `git pull && npm install && npm start`

The output is a triaged set of cover letters in `output/cover-letters/{run_id}/COVER_LETTER/` ready to send, plus a smaller set in `output/cover-letters/{run_id}/REVIEW_QUEUE/` that need human review of the judge's concerns before sending. Logs accumulate in `output/logs/`. Everything else lands in Postgres for searchability and gets archived.

---

## 3. Repo layout

```
.
├── config/                ← profile.json, skills.json, config.json, cookies/
├── src/                   ← monolith TypeScript source (all former packages)
│   ├── filter/
│   ├── fetcher/
│   ├── extractor/
│   ├── scorer/
│   ├── judge/
│   ├── cover-letter/
│   ├── dedup/
│   ├── storage/
│   └── orchestrator/
├── scraper/               ← Python: dice.py, jobright.py, jobspy_adapter.py + common/
├── scripts/               ← CLI scripts (run-pipeline.ts, sort-log.ts, etc.)
├── test/                  ← vitest suites (all modules)
├── fixtures/              ← test fixtures (filter/extractor/judge)
├── migrations/            ← Postgres schema migrations
├── output/                ← gitignored — cover letters + logs per run
└── package.json           ← single root package (npm install once)
```

Monolith migration: former packages moved under `src/`.

---

## 4. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Core runtime | Node.js v22 + TypeScript | Unchanged |
| Scraping fallback | Python 3.11 + Playwright + python-jobspy | Unchanged |
| Orchestration | **Run-level (node-cron + Redis lock + child spawn)** | Built — see §10.12 for deviation from v1 BullMQ design |
| Storage — structured | Postgres 16 + pgvector | Built |
| Storage — ephemeral | Redis 7 | Built |
| LLM provider | **OpenRouter** | Deviation from v1 — see §10.2 |
| Embeddings | **bge-small-en-v1.5 local** via @huggingface/transformers (q8, 384-dim) | Deviation from v1 — see §10.1 |
| Testing | Vitest (TypeScript) + pytest (Python) | Unchanged |
| Scheduler | node-cron in-process (orchestrator) | **Built** |
| Local services | Docker Compose (Postgres + Redis) | Unchanged |

---

## 5. Pipeline — end to end

The pipeline is a 19-stage flow inside one `main()` function in `scripts/run-pipeline.ts`. Stages 0–4 are synchronous and run for every scraped job; stages 5–16 are concurrent (5 jobs in flight at a time via `pLimit(5)`) and only run for jobs that pass the hard filter and the cross-run dedup check.

| Stage | What | Skip condition |
|---|---|---|
| 0 | Run init: load profile, validate, load config, load skill aliases, load resume. `RUN_ID` read from `process.env` if set (orchestrator passes it), otherwise generated fresh | — |
| 1 | Storage init: run migrations, save run record. On failure, call `markStorageDisabled` and continue without persistence | `SKIP_PERSIST=1` |
| 2 | Dedup init: connect to Redis | `SKIP_DEDUP=1` |
| 3 | Profile embedding: compute once, reused for all jobs | scoring disabled |
| 4 | Scrape (subprocess to Python): `python -m scraper --source ... --max ... [--query ...] [--posted-within ONE\|THREE\|SEVEN]` | `JSONL=...` skips scrape |
| 5 | Sanitize each job (clamp suspect values, fix shapes) | — |
| 6 | Hard filter — REJECTs dropped here | — |
| 7 | **Phase 1.5 — Cross-run exact dedup (Redis)** — batch `isSeen()` for every PASS job, drop matches | `SKIP_DEDUP=1` or Redis down |
| 8 | Fetch full JD HTML, extract to plain text | `EXTRACT=0` |
| 9 | Post-fetch checks (staleness, education recovery on real text) | — |
| 10 | LLM extract → structured fields (Zod-validated, citation-verified) | `EXTRACT=0` |
| 11 | Skill normalization through alias map | — |
| 12 | Score (5 components: skills 0.35, semantic 0.25, yoe 0.15, seniority 0.15, location 0.10) | scoring disabled |
| 12.5 | **Cross-site semantic dedup (pgvector)** — only on GATE_PASS jobs with embedding | `SKIP_DEDUP=1` or DB down |
| 13 | Threshold gate: score ≥ 0.55 → GATE_PASS, else ARCHIVE | scoring disabled |
| 14 | LLM judge — STRONG / MAYBE / WEAK + reasoning + concerns | judge disabled |
| 15 | Bucket routing: STRONG+score≥0.70→COVER_LETTER, STRONG+score<0.70→RESULTS, MAYBE→REVIEW_QUEUE, WEAK→ARCHIVE | — |
| 16 | Cover letter (COVER_LETTER bucket always; REVIEW_QUEUE if score ≥ review_queue_threshold) → write `.md` to `output/cover-letters/{run_id}/{bucket}/` | cover disabled |
| 17 | Persist all of the above to Postgres in one transaction; mark seen in Redis | `SKIP_PERSIST=1` / `SKIP_DEDUP=1` |
| 18 | Optional: integrity check comparing Redis seen-set vs Postgres `seen_jobs` | `VERIFY=1` not set |
| 19 | Finish run record — `jobs_total`, `jobs_passed`, `jobs_gated`, `jobs_covered`, `extractions_attempted`, `extractions_succeeded` derived from results array | `SKIP_PERSIST=1` |

Stage 19 gains two new derived counts since v5: `extractions_attempted` (results where `extract_status` is `"ok"` or `"error"`) and `extractions_succeeded` (results where `extract_status` is `"ok"`). No in-loop counters needed — both are derived from the existing `JobResult.extract_status` field after the pipeline loop completes.

---

## 6. Data model

### Postgres schema

**`001_initial.sql`** — unchanged from v5. Seven tables.

- `runs(run_id PK, source, started_at, finished_at, jobs_total, jobs_passed, jobs_gated, jobs_covered)`
- `jobs(job_id, run_id) PK, source, source_url, title, company, posted_at, scraped_at, description_raw, meta JSONB, extracted JSONB, embedding VECTOR(384)`
- `filter_results(job_id, run_id) PK → jobs, verdict, reason, flags JSONB`
- `scores(job_id, run_id) PK → jobs, total, skills, semantic, yoe, seniority, location, scored_at`
- `judge_verdicts(job_id, run_id) PK → jobs, verdict, bucket, reasoning, concerns JSONB, model, judged_at`
- `cover_letters(job_id, run_id) PK → jobs, content, file_path, word_count, model, generated_at`
- `seen_jobs(source, job_id) PK, first_seen` — persistent backing for cross-run dedup, survives Redis flush

**`002_orchestrator.sql`** — new since v5. Adds four columns to `runs` and one partial index.

- `runs.exit_code INT` — child process exit code written by orchestrator runner on completion. NULL while running. `-1` if ghost-reaped.
- `runs.last_heartbeat TIMESTAMPTZ` — updated every 60s by orchestrator runner while child is alive. NULL for runs shorter than 60s (run finished before first heartbeat fired — correct behavior). NULL for pre-migration rows.
- `runs.extractions_attempted INT DEFAULT 0` — populated by `finishRun`. Jobs where `EXTRACT=1` was tried (status `ok` or `error`). Zero when `EXTRACT=0` or all jobs were deduped.
- `runs.extractions_succeeded INT DEFAULT 0` — populated by `finishRun`. Jobs where extraction returned status `ok`.
- `CREATE INDEX runs_unfinished_idx ON runs(last_heartbeat) WHERE finished_at IS NULL` — partial index. The ghost reaper query hits this directly. At most a handful of rows ever have `finished_at IS NULL` so the index is tiny and lookup is trivial.

**`003_labels.sql`** — new since v6 draft. Adds one new table + index for manual scoring calibration.

- `labels(job_id, run_id) PK → jobs, label, notes, labeled_at` — one row per labeled job. `label` is constrained to `{yes, maybe, no}`. FK cascade ensures labels are deleted if the underlying job row is deleted.
- `CREATE INDEX labels_label_idx ON labels(label)` — supports quick label distribution counts.

Indexes on `001_initial.sql`: `jobs_run_idx`, `jobs_source_idx`, `jobs_posted_idx`, `jobs_embedding_hnsw` (HNSW on embedding with `vector_cosine_ops`, m=16, ef_construction=64), `seen_jobs_source_idx`, `seen_jobs_first_seen_idx`.

### Redis keys

- `seen:{source}:{job_id}` — value `"1"`, per-key TTL 7 days. Pipeline dedup.
- `orchestrator:lock:{source}` — value `{run_id}` (string), TTL 14400s (4h) daily / 21600s (6h) Sunday backfill. Prevents overlapping runs. Acquired before spawn, released on child exit. Ghost reaper releases unconditionally via idempotent `DEL` when cleaning up dead runs.

### File outputs

- `scraper/output/{source}_{run_id}.jsonl` — raw scraped jobs
- `scraper/output/results_{source}_{run_id}.jsonl` — pipeline results after all stages
- `output/cover-letters/{run_id}/COVER_LETTER/{title-slug}_{job_id_short}.md` — STRONG+score≥0.70
- `output/cover-letters/{run_id}/REVIEW_QUEUE/{title-slug}_{job_id_short}.md` — MAYBE or STRONG+score<0.70 above review_queue_threshold
- `output/logs/orchestrator.log` — rolling log. All run lifecycle events (start/finish/exit code) and monitor warnings. Primary operational log.
- `output/logs/reaper.log` — rolling log. Ghost reaper sweep events only. Separate from orchestrator.log to keep the main log clean.
- `output/logs/runs/{run_id}.log` — per-run child stdout+stderr captured verbatim. Created at run start, closed on exit. `tail -f` to watch a live run.

### TypeScript types

`storage/src/types.ts` defines `RunRecord`, `RunStats`, `JobRecord`. `RunStats` gains two new fields since v5: `extractions_attempted` and `extractions_succeeded`. The type change is intentionally compile-breaking on callers that don't pass the new fields, forcing the one call site (`run-pipeline.ts`) to be updated.

---

## 7. Project status — what's built, what's not

### Built and tested

| Module | Status | Tests |
|---|---|---|
| Hard filter | ✅ Green | 33 fixtures |
| Profile validation | ✅ Green | 14 cases |
| Sanitize | ✅ Green | 4 fixtures |
| Post-fetch checks | ✅ Green | 7 fixtures |
| Skill normalization | ✅ Green | (via type checks) |
| Compensation utils | ✅ Green | (via filter fixtures) |
| Constants / enums | ✅ Green | N/A |
| Types | ✅ Green | N/A |
| Purity tests | ✅ Green | 4 cases |
| Scraper (dice + jobright + linkedin) | ✅ Green | 66 tests |
| Pipeline runner v5 | ✅ Wired all stages 0–19 | — |
| JD fetcher | ✅ Green | 16 tests |
| Extractor | ✅ Green | 21 tests + 5 real-data fixtures (jd-real-001..005) |
| Scorer (5 components + bge embeddings) | ✅ Green | 44 tests |
| LLM judge | ✅ Green | 30 tests (10 fixtures + bucket logic) |
| Cover letter generator | ✅ Green | wired in pipeline |
| Dedup module (Redis + pgvector) | ✅ Green | 7 tests |
| Storage (Postgres + pgvector) | ✅ Green | 14 tests |
| Storage v4.1 hardening | ✅ Applied | saveJob crash fixed, formatErr, markStorageDisabled |
| Storage v5.1 (orchestrator columns) | ✅ Applied | 002_orchestrator.sql, RunStats updated, persist.ts updated |
| POSTED_WITHIN recency filter | ✅ Wired | env var → cli.py → dice.py |
| Optional integrity check | ✅ Built | `storage/src/integrity.ts`, gated on `VERIFY=1` |
| **Orchestrator** | ✅ **Built** | **16 tests — lock (8) + runner (5) + reaper (3)** |
| Sarath's profile | ✅ Validated | min comp $110k confirmed |
| Docker Compose (Postgres + Redis) | ✅ Built | `docker compose up -d` |

**Test totals: ~248 tests green** (66 scraper + 69 job-filter + 16 fetcher + 16 extractor + 44 scorer + ~30 judge + 7 dedup + 14 storage + 16 orchestrator). Up from 232 in v5.

### Designed but not built

| Component | Design status | Notes |
|---|---|---|
| Scoring calibration on real data | Manual labeling pass | Gated on M8 producing real run history — M8 is now done |
| Notification UI | Out of scope | Defer until 2+ weeks unattended |

### Not built, not designed

- Profile-builder (resume → profile.json) — `profile.json` maintained by hand; low priority for single-user
- Real-data extraction fixtures (target: 5 from Dice) — 1 captured; 4 more needed. Mechanism is wired (`SAVE_FIXTURES=1`); needs real runs and a commit.

---

## 8. Module breakdown

### `config/` — BUILT

- `profile.json` — Sarath's structured profile (v2). 53 skills, 7 target titles. **Authoritative.** Min comp confirmed at $110k.
- `skills.json` — 370 skill alias entries. `buildAliasMap()` flattens to lookup map.
- `config.json` — locked models (`qwen/qwen3.5-flash-02-23` for extract/judge, `deepseek/deepseek-v4-flash` for cover letters), throttle_ms=600, scoring weights (0.35/0.25/0.15/0.15/0.10), gate threshold 0.55, review_queue_threshold 0.70.
- `cookies/` — gitignored. Dice + Jobright browser cookies. Dice is now public-only since the search page needs no auth, but Jobright still requires cookies.

### `job-filter/` — BUILT

Hard-filter stage + pipeline runner (`scripts/run-pipeline.ts`). Pipeline is the execution layer; the orchestrator is the scheduling layer above it. Reads env vars `SOURCE`, `MAX`, `HEADED`, `JSONL`, `EXTRACT`, `SCORE`, `JUDGE`, `COVER`, `SAVE_FIXTURES`, `SKIP_DEDUP`, `SKIP_PERSIST`, `QUERY`, `POSTED_WITHIN`, `VERIFY`, `RUN_ID`.

`RUN_ID` new since v5: if set in the environment, the pipeline uses it rather than generating a new UUID. The orchestrator sets this so both the scheduler and the pipeline refer to the same run record in Postgres. If not set (manual runs), a fresh UUID is generated as before.

### `scraper/` — BUILT

Three adapters under `scraper/`. CLI in `cli.py` dispatches by `--source`.

- `dice.py` — Playwright, paginated. Semantic `data-testid` selectors (stable). Supports `posted_within` for server-side recency filter.
- `jobright.py` — Playwright, infinite scroll. CSS-module hashed selectors (FRAGILE — breaks on frontend rebuilds). Selector constants centralized for fast updates.
- `jobspy_adapter.py` — LinkedIn via python-jobspy. 3 sequential searches, dedup by URL. Does not support `POSTED_WITHIN` — JobSpy doesn't expose LinkedIn's recency filter.
- Common modules (`scraper/common/`): `schema.py`, `normalize.py`, `cookies.py`, `output.py`.

### `fetcher/` — BUILT

Single file `src/fetch.ts`. `fetchJobPage` is non-throwing, uses per-domain 2s polite delay, robots.txt cache, 15s timeout. `extractText` strips script/style/nav/header/footer.

### `extractor/` — BUILT

OpenRouter client (no SDK dependency, raw fetch).

- `src/client.ts` — OpenRouter API call. Currently uses `response_format: { type: "json_object" }` — the json_schema strict-mode upgrade is drafted but not applied.
- `src/prompt.ts` — `PROMPT_VERSION = "v1"`. Extract-don't-infer. Exact substring quotes 5–15 words.
- `src/validate.ts` — Zod schema. Strips markdown fences if model ignored JSON mode.
- `src/extract.ts` — Never throws. Retries once on Zod failure (1s backoff). `verifyCitations` nulls bad quotes; partial extraction kept rather than rejected. `_callWithRetry` handles HTTP-level errors. `DEBUG_EXTRACT=1` env var triggers raw-response preview on validation failure.
- 3 synthetic fixtures (`jd-001`, `jd-002`, `jd-003`) plus 1 real-data fixture (`jd-real-002-java-full-stack-developer`). Pipeline supports `SAVE_FIXTURES=1` to capture more.

### `scorer/` — BUILT

5 pure scoring functions in `src/components.ts`, weighted-summed in `src/score.ts`. `embed.ts` lazy-loads `bge-small-en-v1.5` (q8) via `@huggingface/transformers`. LRU cache 500 entries by SHA256. Returns `Float32Array(384)`. Zero vector on failure.

Real-data validation confirmed (2026-04-25): scores 0.777–0.790 across 4 Dice jobs. Components behave as designed — `seniority=1.00` and `location=1.00` for senior roles in Sarath's market, `semantic=0.57–0.66` reflecting embedding quality.

### `judge/` — BUILT

LLM judge stage. Inputs: structured job fields + score breakdown (NOT raw JD text). Output: `{verdict: STRONG|MAYBE|WEAK, reasoning, concerns[]}`. Two retry layers: HTTP-level (1 retry on network error, 2s backoff) and validation-level (1 retry on Zod failure, 2s backoff). `getBucket(judgeResult, totalScore)` does the routing — STRONG+score≥0.70 → COVER_LETTER, STRONG+score<0.70 → RESULTS, MAYBE → REVIEW_QUEUE, WEAK or judge error → ARCHIVE.

Real-data validation confirmed (2026-04-25): judge correctly identified Citi (named enterprise, fintech domain) and TD Bank (major bank, fintech domain) as STRONG; correctly flagged KeyCorp as MAYBE for React gap; correctly flagged staffing agency role as MAYBE for unnamed end client.

### `cover-letter/` — BUILT

Model switched from `google/gemma-4-31b-it` to `deepseek/deepseek-v4-flash` since v5. Run-scoped output dirs (`output/cover-letters/{run_id}/{bucket}/`). Bucket subfolders separate `COVER_LETTER` from `REVIEW_QUEUE` for triage. Retry-once on timeout with 2s backoff.

Real-data validation confirmed (2026-04-25): 4 cover letters generated, 206–243 words each. COVER_LETTER and REVIEW_QUEUE subfolders populated correctly.

### `dedup/` — BUILT

Two complementary mechanisms.

**Cross-run exact dedup (`src/redis.ts`)**: Redis SET with per-key TTL. Key shape `seen:{source}:{job_id}`, value `"1"`, TTL 7 days. `isSeen()`, `markSeen()`, `markSeenBulk()` — all non-throwing, gracefully no-op when Redis is down. `_connectionFailed` flag prevents repeated reconnect attempts.

**Cross-site semantic dedup (`src/pgvector.ts`)**: pgvector cosine similarity on the `jobs.embedding` column (HNSW index). Default threshold 0.88, lookback 7 days. Non-throwing — returns null on any DB error.

Real-data validation confirmed (2026-04-25): second run against same 10 Dice jobs produced 9/9 DEDUP correctly. All jobs from first run were marked seen in Redis; second run correctly skipped all of them without re-processing.

### `storage/` — BUILT (v4.1 + v5.1)

Postgres + pgvector persistence.

- `src/db.ts` — `pg.Pool` singleton with `describeErr` formatting on the error listener.
- `src/persist.ts` — `saveRun`, `finishRun`, `saveJob`, `isSeenInDB`. All non-throwing. v4.1: `pool.connect()` inside try block, `markStorageDisabled`, `formatErr`. v5.1 additions: `updateHeartbeat` (called every 60s by orchestrator runner), `markRunExitCode` (called by runner on child exit and by ghost reaper for dead runs), `getUnfinishedRuns` (ghost reaper query — hits partial index), `getRunStats` (monitor post-run check).
- `src/migrate.ts` — runs SQL files in `migrations/` in alphabetical order.
- `src/integrity.ts` — `verifyIntegrity`. Gated on `VERIFY=1`.
- `src/types.ts` — `RunRecord`, `RunStats` (gains `extractions_attempted`, `extractions_succeeded` in v5.1), `JobRecord`.
- `migrations/001_initial.sql` — full schema (unchanged from v5).
- `migrations/002_orchestrator.sql` — new in v5.1: 4 columns + partial index on `runs`.
- `test/persist.test.ts` — 14 tests. All pass against updated `finishRun` — disabled-state tests don't touch SQL, compile-time enforcement handles the new fields at the call site.

### `orchestrator/` — BUILT (new in v6)

Run-level orchestration. Schedules `run-pipeline.ts` via node-cron, prevents overlapping runs with a Redis lock, captures failures, and emits warnings on degraded conditions. Zero changes to `run-pipeline.ts` beyond the `RUN_ID` env var and the two `finishRun` fields.

**Files:**

- `src/index.ts` — entry point. Boots cron schedules, handles SIGTERM/SIGINT (stops new ticks, allows in-flight runs to finish via runner's own SIGTERM forwarding). Unhandled rejection safety net logs and continues rather than crashing the scheduler.
- `src/scheduler.ts` — cron definitions per source + ghost reaper tick. Uses a per-schedule `running` flag to guard against slow ticks overlapping with the next fire of the same expression.
- `src/runner.ts` — acquires lock, spawns `run-pipeline.ts` as a child process, pipes stdout/stderr to both the terminal and `output/logs/runs/{run_id}.log`, sends heartbeat `UPDATE` to Postgres every 60s, writes `exit_code` on child exit, calls monitor, releases lock. SIGTERM forwarding: sends SIGTERM to child, waits 30s for clean exit, SIGKILLs if still running. `pLimit(5)` in the pipeline means in-flight jobs complete and `finishRun` runs cleanly before the process exits.
- `src/lock.ts` — Redis `SET NX EX` wrapper. `acquireLock` returns `run_id` on success, `null` if held or Redis down. `releaseLock` uses `DEL` — idempotent, safe to call on missing or expired key. `REDIS_URL` read inside `getClient()` on each new client creation (not at module load), so tests can override the env var.
- `src/monitor.ts` — post-run stats check. Three warning conditions: (1) `jobs_total === 0` — scraper produced nothing (broken selectors, auth expired, IP blocked); (2) `extractRate < 0.5 && attempted > 5` — extraction degraded (OpenRouter credits, rate limit); (3) `jobs_passed > 10 && jobs_covered === 0` — pipeline degraded end-to-end. Writes success line on clean runs. All output goes to `output/logs/orchestrator.log`. The `> 5` guard on condition 2 correctly suppresses the warning when all jobs were deduped before extraction ran (`attempted = 0`).

**Cron schedule:**

| Source | Expression | POSTED_WITHIN | MAX | TTL |
|---|---|---|---|---|
| Dice daily (Mon–Sat) | `0 9,13,17,21 * * 1-6` | ONE | 50 | 4h |
| Dice backfill (Sun 9am) | `0 9 * * 0` | SEVEN | 100 | 6h |
| Dice Sun afternoons | `0 13,17,21 * * 0` | ONE | 50 | 4h |
| Jobright (daily) | `0 10 * * *` | ONE | 50 | 4h |
| LinkedIn (daily) | `0 14 * * *` | — | 30 | 4h |
| Ghost reaper | `*/10 * * * *` | — | — | — |

Jobright and LinkedIn are offset from Dice by 1h to avoid hitting OpenRouter simultaneously. Sunday 9am uses the backfill config only — the `1-6` constraint on the daily schedule prevents a conflict. Sunday afternoons get their own schedule so they're not dark after the backfill.

**Ghost reaper:** Runs every 10 minutes. Finds `runs` rows where `finished_at IS NULL AND last_heartbeat IS NOT NULL AND last_heartbeat < NOW() - '5 minutes'::INTERVAL` (these are processes that died without calling `finishRun` — OOM, SIGKILL, hard crash). For each ghost: releases the Redis lock unconditionally, sets `exit_code = -1`, sets `finished_at = NOW()`. Writes to `output/logs/reaper.log`. Note: the `last_heartbeat IS NOT NULL` guard means pre-migration rows and runs shorter than 60s (never got a heartbeat) are correctly ignored.

**Tests (`test/`):**
- `lock.test.ts` — 8 tests: Redis-down contract (3, no infra needed) + real Redis (5, `RUN_INFRA_TESTS=1`). Tests: acquire when free, acquire when held, release allows re-acquire, release idempotent, isLockHeld before/after.
- `runner.test.ts` — 5 tests: lock and monitor are stubbed. Tests: acquireLock called with correct args, returns -1 when lock not acquired, releaseLock not called when lock skipped, monitor not called when lock skipped, mock infrastructure wired correctly.
- `reaper.test.ts` — 3 tests (`RUN_INFRA_TESTS=1`): ghost row gets `exit_code=-1` and `finished_at` set, healthy row untouched, pre-migration row (null heartbeat) ignored.

**Entry point:** `npm start`

**One-shot trigger for testing:** `npx tsx src/orchestrator/trigger-once.ts`

---

## 9. Decisions

Carried forward from v5 unchanged (1–17).

New since v5:

18. **Run-level orchestration, not BullMQ per stage.** v1 sketched per-stage BullMQ queues. We built run-level orchestration (node-cron → Redis lock → spawn `run-pipeline.ts`). Reason: BullMQ per stage requires serializing `Float32Array(384)` embeddings and full `description_raw` text through Redis between every stage boundary, breaks the `run_id` model the entire Postgres schema is built around, and requires rewriting working pipeline logic. The concurrency problem BullMQ solves (`pLimit(5)` and `throttle_ms`) is already solved. BullMQ per stage becomes the right architecture when volume exceeds ~1000 jobs/run — that's not today. See §10.12 for the full authenticity report entry.

19. **Lock value is `run_id` only, not `{run_id, pid}`.** PID was proposed as a lock value for diagnostic purposes. Rejected: PID reuse is real on any long-running system — a new process can get the same PID as a dead one, making stale lock checks misleading. TTL is the safety net. `run_id` stored in the lock value is enough to correlate with the `runs` table if you need to inspect manually.

20. **Heartbeat + reaper for hard crash detection, not just exit code.** Exit code alone can't distinguish "still running" from "died without writing exit code" (OOM kill, SIGKILL). Heartbeat updated every 60s while child is alive; ghost reaper queries for stale heartbeats every 10 minutes. Every run reaches terminal state within 5 minutes of dying. Pre-migration rows and short runs (< 60s) have `NULL` heartbeat and are correctly ignored by the `IS NOT NULL` guard.

21. **Monitor has three specific warning conditions, not a generic health score.** The three conditions (zero jobs scraped, low extraction rate, zero cover letters despite passing jobs) each represent a distinct failure class with a distinct root cause. A generic "health score" would obscure which part of the pipeline is broken. Each condition maps to a specific action: zero scrape → check selectors/cookies; low extraction → check OpenRouter credits/rate limits; zero cover letters → check judge/cover letter config.

---

## 10. Authenticity report — deviations from the v1 plan

All previous deviations (10.1–10.11) carried forward unchanged from v5.

### 10.12 Orchestrator — BullMQ per stage → run-level orchestration (justified)

**Original (v1, §5 / §10 orchestrator):** "BullMQ queues, worker processes, node-cron scheduler. Queue shape: scrape / filter / fetch / extract / score / judge / cover-letter. Concurrency limits per queue to respect LLM rate limits."

**Built:** node-cron scheduler + Redis `SET NX EX` lock + `child_process.spawn` of `run-pipeline.ts`. No BullMQ. No per-stage queues. No worker processes. The pipeline runs as a single child process exactly as it did when invoked manually.

**Why:** Four concrete reasons. First, **inter-stage data passing cost**: BullMQ requires all job data to be serialized into Redis between stages. `Float32Array(384)` embeddings, `description_raw` text (up to 12KB per JD), and full extracted JSON must round-trip through Redis 7 times per job. This is pure overhead for data that currently lives in memory for 20–40 minutes. Second, **`run_id` model breakage**: the entire Postgres schema (`runs`, `jobs`, `filter_results`, `scores`, `judge_verdicts`, `cover_letters`, `seen_jobs`), the output directory structure (`output/cover-letters/{run_id}/`), and `saveRun`/`finishRun` are all built around a run as one atomic execution. With per-stage queues, "a run" stops being a coherent unit — jobs from run A would be in the extract queue when run B starts. Third, **solved problem**: `pLimit(5)` handles per-job concurrency, `throttle_ms=600` handles LLM rate limiting — the two things BullMQ would provide are already built. Fourth, **testing cost**: moving each stage into a BullMQ worker would require rewriting the wiring code that connects all modules, without adding capability. 232 tests would need re-verification.

The run-level approach adds the actual missing pieces: overlap prevention (Redis lock), failure visibility (exit code in DB, per-run log), hard crash detection (heartbeat + reaper), and degraded-pipeline warnings (monitor). These satisfy the M8 exit criterion without touching the working pipeline.

**When to revisit:** When running multiple sources in parallel (not sequentially), when volume exceeds ~1000 jobs/run, or when per-job stage visibility is needed for debugging. At that point the BullMQ migration is straightforward because the pipeline modules are already pure functions with clean interfaces.

**Verdict:** Pragmatic deviation. v1 designed the orchestrator before the pipeline existed; the pipeline's design choices (in-memory data passing, `run_id` scoping) made per-stage queuing impractical without significant refactoring. Run-level orchestration delivers the same operational properties at 1/10th the complexity.

---

## 11. Improvements over the original plan

All previous improvements (1–10) carried forward from v5.

11. **Run-level orchestration with Option 2.5 hardening.** The base "just wrap the pipeline in cron" approach (Option 3) was extended with four additions that collectively satisfy "no silent failures": Redis lock prevents overlap, heartbeat + ghost reaper detect hard crashes within 5 minutes, monitor catches degraded-but-exited-0 conditions (OpenRouter credits dying, scraper returning zero jobs), SIGTERM forwarding allows clean restarts. Each addition addresses a specific failure mode that Option 3 would have missed.

12. **Separate log files for separate concerns.** `orchestrator.log` (run lifecycle + warnings), `reaper.log` (ghost sweep events), `runs/{run_id}.log` (child stdout/stderr verbatim). Mixing all three would make the operational log noisy. The separation means you watch `orchestrator.log` daily, look at `reaper.log` only when investigating ghost runs, and use per-run logs only for deep debugging.

13. **Monitor's `> 5` guard handles `EXTRACT=0` runs correctly.** When extraction is disabled or all jobs are deduped before extraction, `extractions_attempted = 0`. A naive `extractRate < 0.5` check would fire a false warning (0/0 = 0%). The `attempted > 5` guard suppresses it. The orchestrator always runs with `EXTRACT=1`, so this matters only for manual runs — but the guard makes the monitor safe to call in all contexts.

14. **`REDIS_URL` read inside `getClient()`, not at module load.** The original `lock.ts` read `REDIS_URL` as a module-level constant. This caused the Redis-down test to fail: the test set `process.env.REDIS_URL` to a dead port, but the module had already captured the real URL at import time, so `getClient()` still connected to real Redis and the lock succeeded. Moving the read inside `getClient()` means each new client creation picks up the current env var, making the test work correctly and making the module behave predictably when the env is changed at runtime.

15. **Extractor strict `json_schema` response_format.** Switched extractor to OpenRouter `json_schema` strict mode (with a JSON Schema mirror of the Zod schema). Eliminates markdown-fence and missing-field edge cases at the model level, with a fallback to `json_object` via `EXTRACTOR_FORCE_JSON_OBJECT=1` for models that reject strict mode.

16. **Global `SAVE_FIXTURES` cap.** The fixture capture counter now seeds from existing `jd-real-###-*` fixtures on disk, making the “max 5” cap global across runs instead of per-run (prevents unattended mode from writing 5 new fixtures every tick forever).

17. **Labeling CLI + labels table for M9 calibration.** A `labels(job_id, run_id, label, notes, labeled_at)` table and `storage/src/label-cli.ts` CLI allow fast manual ground-truth labeling of judged jobs (y/m/n/skip/quit), enabling future scoring weight calibration against real data.

---

## 12. Known issues and open decisions

### Open — code drafted, not landed

1. **Two-phase pgvector dedup (hash gate).** Current `findSemanticDuplicate` runs the expensive cosine query directly. Phase 1 hash gate `(normalized_company + normalized_title) LIKE` was drafted but not landed. Low priority while volume stays under ~100 jobs/run.

### Open — additional fixtures to capture

### Open — calibration

2. **Scoring not calibrated on real data.** Weights (0.35/0.25/0.15/0.15/0.10) and threshold (0.55) are designed values. M8 is now done — real run history is accumulating. After ~50 labeled jobs from unattended runs, manually rank "would apply / maybe / no" and tune against ground truth. This is now unblocked.

### Open — operational reminders

5. **Cookie rotation.** Jobright still requires cookies (Dice is now public). If Jobright scraper fails with auth error, rotate via browser extension → `config/cookies/jobright.json` (never commit).

6. **OpenRouter credit.** Confirmed failure mode from testing: a 401 `User not found` error causes every extraction in a run to fail silently from the pipeline's perspective (jobs archive with `extraction_failed` flag). The monitor now catches this (condition 2: `extractRate < 0.5 && attempted > 5`) and emits a warning. Top up before credits run out. At projected volume (~$0.50–1.00/day) a $10 deposit lasts 2–3 weeks.

7. **Jobright selectors are fragile.** CSS-module hashed class names break on any frontend rebuild. Selector constants centralized at top of `jobright.py` for fast updates, but still needs manual intervention.

8. **Ghost reaper does not clean up runs shorter than 60s with a hard crash.** If a run crashes before its first heartbeat fires (first 60s), `last_heartbeat IS NULL` and the reaper's `IS NOT NULL` guard skips it. The `runs` row will have `finished_at IS NULL` forever unless manually cleaned. This is an accepted limitation: runs shorter than 60s that crash hard are rare (scraper and embedding load time alone takes 10–20s), and the `finished_at IS NULL` rows are queryable. The alternative — tracking a "started" heartbeat separately from the "alive" heartbeat — adds complexity for a very rare edge case.

---

## 13. Roadmap

### Done

- ✅ Milestone 1 — scrape → filter → print
- ✅ Milestone 2 — fetch → extract → pipeline
- ✅ Milestone 3 — score → gate
- ✅ Milestone 4 — real-data validation (confirmed 2026-04-23, Dice, 20 jobs)
- ✅ Milestone 5 — LLM judge (WEAK / MAYBE / STRONG routing)
- ✅ Milestone 6 — cover letter generator (.md per job, run-scoped output)
- ✅ Milestone 7 — Persistence: Postgres + pgvector + Redis. Storage tables built, dedup wired, run-pipeline persists every stage's output. v4.1 hardening complete.
- ✅ **Milestone 8 — Orchestrator**: Run-level orchestration with node-cron, Redis lock, heartbeat, ghost reaper, monitor. Pipeline runs unattended. Exit criterion satisfied: full e2e run confirmed (2026-04-25, Dice, 10 jobs, 4/4 extractions, 2 cover letters, 2 REVIEW_QUEUE letters, correct dedup on second run).

### Next: Milestone 9 — Scoring calibration

Now unblocked by M8. Real run history is accumulating via the orchestrator's unattended schedule.

Steps:
1. Let the orchestrator run for 1–2 weeks, accumulating real Dice + Jobright + LinkedIn jobs.
2. Pull 30–50 jobs from Postgres that have judge verdicts.
3. Manually label each: "would apply" / "maybe" / "no" (use `cd storage && npm run label`).
4. Compare labels against `(score.total, judge.verdict)` pairs.
5. Tune the five scoring weights (0.35/0.25/0.15/0.15/0.10) and the gate threshold (0.55) against ground truth.
6. Capture more real-data extraction fixtures during this pass (target: 5 total).

Exit criterion: scoring weights produce a ranked list where the top 10 jobs by score match the "would apply" labels at a rate ≥ 80%.

### Milestone 10 — Notification UI

Out of scope until everything runs unattended for 2+ weeks without manual intervention. Candidates: email digest, web dashboard, mobile push. Decide based on what's actually painful after a few weeks of cron runs.

### Profile-builder (low priority)

Resume → profile.json automation. Hand-maintained for now. Build only if profile starts changing frequently.

---

## 14. Onboarding

### Prerequisites

- Node.js v22+, npm v10+
- Python 3.11+, pip
- Docker (for Postgres + Redis)

### First-time setup

```bash
# 1. Local services
docker compose up -d                  # Postgres (with pgvector) + Redis
docker compose ps                     # confirm both healthy

# 2. Install deps + run the full TypeScript test suite
npm install
npm test

# 3. Python scraper
cd ../scraper
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium

# 4. Cookies — only Jobright needs them (Dice search is public)
# Export Jobright cookies from browser → config/cookies/jobright.json (never commit)

# 5. Run migrations
npx tsx src/storage/migrate.ts

# 6. .env at project root
echo 'OPENROUTER_API_KEY=sk-or-...' > .env
echo 'DATABASE_URL=postgresql://postgres:postgres@localhost:5432/jobhunter' >> .env
echo 'REDIS_URL=redis://localhost:6379' >> .env

# 7. Start orchestrator (runs forever, unattended)
npm start
```

### One-shot manual trigger (testing)

```bash
# Run one pipeline tick immediately without waiting for cron
npx tsx src/orchestrator/trigger-once.ts

# Watch it live in a second terminal
tail -f output/logs/orchestrator.log
tail -f output/logs/runs/<run_id>.log
```

### Unattended mode (production)

```bash
npm start
# Logs accumulate in output/logs/orchestrator.log
# Cover letters appear in output/cover-letters/{run_id}/COVER_LETTER/
# Review queue in output/cover-letters/{run_id}/REVIEW_QUEUE/
```

### Manual run modes (bypassing orchestrator)

```bash
# Full pipeline, fresh jobs only
POSTED_WITHIN=ONE EXTRACT=1 SOURCE=dice MAX=20 \
  npx tsx scripts/run-pipeline.ts

# Backfill last 7 days
POSTED_WITHIN=SEVEN EXTRACT=1 SOURCE=dice MAX=100 npx tsx scripts/run-pipeline.ts

# Bypass dedup (force re-process all jobs — useful for testing)
SKIP_DEDUP=1 EXTRACT=1 SOURCE=dice MAX=5 npx tsx scripts/run-pipeline.ts

# Bypass persistence
SKIP_PERSIST=1 EXTRACT=1 SOURCE=dice MAX=5 npx tsx scripts/run-pipeline.ts

# Replay an existing JSONL (no scrape, no API cost)
JSONL=scraper/output/dice_<run_id>.jsonl EXTRACT=1 npx tsx scripts/run-pipeline.ts

# Save the next 5 successful extractions as fixtures
SAVE_FIXTURES=1 EXTRACT=1 SOURCE=dice MAX=20 npx tsx scripts/run-pipeline.ts

# Run integrity check at end (Redis ↔ Postgres seen-state)
VERIFY=1 EXTRACT=1 SOURCE=dice MAX=20 npx tsx scripts/run-pipeline.ts
```

### Infra tests (real Redis + Postgres required)

```bash
RUN_INFRA_TESTS=1 npm test
# lock — real Redis (5 tests)
# reaper — real Postgres + Redis (3 tests)
```

### Inspecting results

```bash
# Cover letters — most recent run
ls -lt output/cover-letters/ | head -3
ls output/cover-letters/<latest-run-id>/COVER_LETTER/

# Orchestrator health
tail -20 output/logs/orchestrator.log

# Postgres — full run history with orchestrator columns
psql $DATABASE_URL -c "
  SELECT run_id, source, jobs_total, jobs_passed, jobs_covered,
         extractions_attempted, extractions_succeeded,
         exit_code, last_heartbeat, finished_at
  FROM runs
  ORDER BY started_at DESC
  LIMIT 10;
"

# Postgres — verdicts and cover letter paths
psql $DATABASE_URL -c "
  SELECT j.title, j.company, jv.verdict, jv.bucket, cl.file_path
  FROM jobs j
  LEFT JOIN judge_verdicts jv ON jv.job_id = j.job_id AND jv.run_id = j.run_id
  LEFT JOIN cover_letters cl ON cl.job_id = j.job_id AND cl.run_id = j.run_id
  WHERE j.source = 'dice'
  ORDER BY j.scraped_at DESC LIMIT 20;
"

# Redis — seen job count for a source
redis-cli --scan --pattern 'seen:dice:*' | wc -l

# Redis — check for active orchestrator locks
redis-cli --scan --pattern 'orchestrator:lock:*'
```

---

## 15. How to contribute

1. Read this doc before writing code.
2. Fixture-first: bug → fixture fails → fix → fixture passes.
3. Keep `hardFilter` and all scoring functions pure.
4. Run `npm test` in the affected module before committing.
5. Update this file when module status changes.
6. When in doubt about Sarath's preferences, `config/profile.json` is authoritative.
7. New env vars get documented in §14 and in the relevant module's header comment.
8. Orchestrator schedules live in `orchestrator/src/scheduler.ts` — that is the single source of truth for when the pipeline runs.

---

## 16. Glossary

- **Hard filter** — deterministic rule-based stage. Rejects using listing metadata only.
- **JD** — job description (full body text, fetched separately from listing).
- **PASS / REJECT / DEDUP** — hard filter + Redis dedup outcomes.
- **GATE_PASS / ARCHIVE** — scoring gate outcomes (score above/below 0.55 threshold).
- **Flag** — soft signal on a job. Doesn't reject; LLM judge sees it.
- **Fixture** — JSON test case with inputs + expected outputs.
- **Run** — one pipeline execution. Produces a unique `run_id`.
- **Bucket** — final destination: COVER_LETTER | RESULTS | REVIEW_QUEUE | ARCHIVE.
- **Citation** — quote from description_raw verifying an extracted field.
- **STRONG** — judge verdict: apply. Cover letter written to COVER_LETTER bucket if score ≥ 0.70.
- **MAYBE** — judge verdict: review concerns before applying. Cover letter written to REVIEW_QUEUE if score ≥ review_queue_threshold.
- **WEAK** — judge verdict: don't apply.
- **POSTED_WITHIN** — Dice server-side recency filter. Values: ONE (24h), THREE (3 days), SEVEN (7 days).
- **VERIFY** — env var that enables the post-run integrity check (Redis ↔ Postgres consistency).
- **AggregateError** — Node's wrapper class when multiple parallel attempts fail (typically pg's IPv4+IPv6 dual-stack connect attempts). Default message is empty; `formatErr` unwraps `.errors[]`.
- **markStorageDisabled** — module-level boolean in `storage/src/persist.ts`. Set after a startup failure so subsequent persist calls become silent no-ops.
- **Ghost run** — a `runs` row where `finished_at IS NULL` and `last_heartbeat` has gone stale (> 5 minutes). Indicates the child process died hard without calling `finishRun`. Cleaned up by the ghost reaper with `exit_code = -1`.
- **Ghost reaper** — cron task in `orchestrator/src/scheduler.ts` that runs every 10 minutes. Detects ghost runs, marks them terminal, releases their Redis locks.
- **Heartbeat** — `UPDATE runs SET last_heartbeat = NOW()` sent every 60s by the orchestrator runner while a child process is alive. Enables ghost detection.
- **Lock** — Redis key `orchestrator:lock:{source}` with `SET NX EX`. Prevents two pipeline runs for the same source from overlapping. TTL is the safety net; the runner also releases it explicitly on clean exit.
- **Monitor** — post-run function in `orchestrator/src/monitor.ts`. Checks three warning conditions after each run and writes to `output/logs/orchestrator.log`.
- **Run-level orchestration** — the architectural pattern where the orchestrator schedules and supervises full pipeline runs as atomic units, rather than managing individual pipeline stages as separate queue workers.

---

## 17. Reference documents

- `THE-BIBLE.md` — v1 (2026-04-17) — original architecture
- `THE-BIBLE-v2-update.md` — v2 (2026-04-18) — milestones 1+2 shipped, 5 patches
- `THE-BIBLE-v3.md` — v3 (2026-04-20) — milestone 3 shipped, scorer built
- `THE-BIBLE-v4.md` — v4 (2026-04-23) — milestones 4–6 shipped, real-data validation
- `THE-BIBLE-v5.md` — v5 (2026-04-25) — milestone 7 shipped, dedup + storage + integrity + POSTED_WITHIN
- `THE-BIBLE-v6.md` — v6 (2026-04-25) — **this document** — milestone 8 shipped, orchestrator + storage v5.1 + end-to-end validation
- `design-v4.md` — design doc covering scoring/judge contracts
- `STORAGE-CHANGES.md` — v4.1 changeset detail (saveJob fix, formatErr, markStorageDisabled)
- `extractor/fixtures/` — synthetic + real extraction test cases
- `judge/fixtures/` — 10 judge test cases
- `storage/migrations/001_initial.sql` — full schema
- `storage/migrations/002_orchestrator.sql` — orchestrator columns + partial index
- `storage/migrations/003_labels.sql` — manual labeling table for scoring calibration (M9)
- `docker-compose.yml` — local services
