# Operations + Configuration + Decision Log — job-hunter (Sections 6–8)

This document covers:

- **Section 6** — configuration reference (`config/*.json`, scoring weights, filter rules, judge prompt shape)
- **Section 7** — operational guide (logs, common failures, calibration, adding sources)
- **Section 8** — decision log (architectural deviations carried forward in `THE-BIBLE-v7.md`)

---

## 6. Configuration Reference

### 6.1 `config/config.json`

This file controls LLM model selection, throttling, scoring weights, and thresholds. It also contains a legacy `pipeline` block that is **not** used by the orchestrator schedules.

#### Top-level keys

| Key | Type | Meaning |
|---|---|---|
| `llm` | object | LLM configs for extractor, judge, cover letters |
| `scoring` | object | gate threshold + weights |
| `embeddings` | object | embedding model metadata (local) |
| `pipeline` | object | **legacy/unused** schedule defaults (actual schedules are in `src/orchestrator/scheduler.ts`) |

#### `llm.extractor`

| Key | Type | Meaning |
|---|---|---|
| `model` | string | OpenRouter model ID used for extraction |
| `max_tokens` | number | Token cap for extraction response |
| `temperature` | number | Extraction temperature (typically 0) |
| `throttle_ms` | number | Courtesy delay between extractor calls in pipeline |
| `reasoning` | object | OpenRouter “reasoning” config (typically disabled for speed) |

Extractor strict JSON mode:

- Default: strict `response_format.type="json_schema"` with `src/extractor/schema.ts`
- Fallback: set `EXTRACTOR_FORCE_JSON_OBJECT=1` to force `json_object` mode.

#### `llm.judge`

Same shape as extractor, but judge uses JSON object mode in `src/judge/client.ts` and `max_tokens` is smaller.

#### `llm.cover_letter`

| Key | Type | Meaning |
|---|---|---|
| `model` | string | Model ID for cover letters |
| `max_tokens` | number | Token cap |
| `temperature` | number | Higher than extraction (prose generation) |
| `throttle_ms` | number | Courtesy delay between cover-letter calls |
| `review_queue_threshold` | number | If a job is `REVIEW_QUEUE` but score ≥ this value, still generate a draft |
| `thinking` | object | Optional model thinking config (passed through to OpenRouter) |

#### `scoring`

| Key | Type | Meaning |
|---|---|---|
| `gate_threshold` | number | Minimum score to proceed to judge |
| `weights.skills` | number | Skills weight |
| `weights.semantic` | number | Semantic weight |
| `weights.yoe` | number | YOE weight |
| `weights.seniority` | number | Seniority weight |
| `weights.location` | number | Location weight |

Current values (as shipped):

- `gate_threshold`: **0.50**
- weights: skills **0.35**, semantic **0.25**, yoe **0.15**, seniority **0.15**, location **0.10**

#### `embeddings`

Metadata only; the embedder implementation is in `src/scorer/embed.ts`.

#### `pipeline` (legacy/unused)

This includes `schedule`, `sources`, etc. The project treats it as informative commentary; the orchestrator does not read this block. The actual schedules are hardcoded in `src/orchestrator/scheduler.ts`.

---

### 6.2 `config/profile.json`

**Structure summary (what fields exist and how they are used):**

| Field | Used by | How |
|---|---|---|
| `target_titles[]` | scoring embeddings | Embedded into profile vector (`embedProfile`) |
| `acceptable_seniority[]` | hard filter + scoring | Hard filter rejects outside range; scorer scores ordinal distance |
| `acceptable_employment[]` | hard filter | Reject mismatched employment types |
| `location.*` | hard filter + scoring | Enforces acceptable types/cities/countries; scorer assigns partial credit on unknowns |
| `compensation.*` | hard filter | Reject postings below minimum comp when salary present |
| `skills[]` | scorer + cover letters | Built/maintained as structured skills list; used for scoring and prompts |
| `years_experience` | hard filter + scorer | Reject large underqualification; score YOE fit |
| `education.degree` | hard filter | Reject if job minimum degree exceeds candidate |
| `work_authorization.requires_sponsorship` | hard filter + judge/cover-letter prompts | Reject if job explicitly says no sponsorship; judge prompt treats null sponsorship as neutral |
| `work_authorization.clearance_eligible` | hard filter | Reject if clearance required and not eligible |
| `preferred_domains[]` | judge + cover letter prompt | Context for domain fit |
| `deal_breakers[]` | judge prompt | Used as context (hard filter already enforces some) |

Validation:

- `src/filter/validate.ts` throws on invalid enums/shape.
- Tests: `test/filter/validate.test.ts`.

---

### 6.3 Scoring weights

Implementation:

- Component functions: `src/scorer/components.ts`
- Composite and redistribution behavior: `src/scorer/score.ts`

Important nuance: if semantic embeddings are unavailable, `scoreJob()` redistributes the semantic weight across the other components so the max achievable score stays close to 1.0.

---

### 6.4 Filter rules

Implementation: `src/filter/filter.ts` `hardFilter(job, profile)`.

Rule order (and outcomes):

1. **Visa**: if job explicitly says no sponsorship and profile requires sponsorship → REJECT `no_sponsorship`; if unclear → flag `sponsorship_unclear`.
2. **Clearance**: reject if clearance required and profile not eligible; unclear → flag `clearance_unclear`.
3. **Location**: reject if location type/country/city mismatches, else flag `remote_unclear` when unparseable.
4. **Seniority**: reject if unknown or too far outside acceptable range; adjacent-high → flag `seniority_adjacent`.
5. **Education**: reject if job minimum degree exceeds profile’s degree.
6. **Employment type**: reject mismatch; unclear → flag `employment_type_unclear`.
7. **YOE**: reject if min requirement > profile + 2; overqualified → flag `overqualified`; missing → flag `years_experience_missing`.
8. **Compensation**: reject if salary present and below floor; otherwise flags for missing/unsupported currency/interval.

---

### 6.5 Judge prompt

Implementation:

- `src/judge/prompt.ts` → `SYSTEM_PROMPT` and `buildJudgePrompt(input)`
- `src/judge/validate.ts` → Zod parsing

Input shape (what the LLM sees):

- Structured job fields (title/company/seniority/employment/domain/skills/YOE/education/visa/responsibilities/flags)
- Score breakdown (total + 5 components)

Output shape:

```json
{
  "verdict": "STRONG|MAYBE|WEAK",
  "reasoning": "1-3 sentence explanation",
  "concerns": ["..."]
}
```

---

## 7. Operational Guide

### 7.1 Reading logs

| Log path | Produced by | What it contains | When to read |
|---|---|---|---|
| `output/logs/orchestrator.log` | orchestrator monitor | Schedule ticks, run start/finish, warnings | Daily primary health check |
| `output/logs/reaper.log` | ghost reaper | Ghost run cleanup events | When investigating stuck runs/locks |
| `output/logs/runs/{run_id}.log` | runner child piping | Raw pipeline stdout/stderr for that run | Deep debugging a specific run |

### 7.2 Common failure modes and fixes

- **OpenRouter credits exhausted / bad key**
  - **Symptom**: many extractions fail; `extractions_succeeded/extractions_attempted` low; monitor warns.
  - **Cause**: `OPENROUTER_API_KEY` invalid or account out of credits.
  - **Fix**: update `.env` key; top up credits; re-run.

- **Jobright session/cookie expired**
  - **Symptom**: `jobright_api` returns 0 jobs or API errors.
  - **Cause**: expired `SESSION_ID` in `config/cookies/jobright_api.json`.
  - **Fix**: export fresh cookie/session and replace file (never commit).

- **Redis not running**
  - **Symptom**: dedup disabled; orchestrator locks fail (runs skipped).
  - **Cause**: Redis container stopped.
  - **Fix**:

```bash
docker compose up -d redis
```

- **Postgres not running**
  - **Symptom**: persistence disabled; UI server fails queries; orchestrator heartbeat/exit code writes fail.
  - **Fix**:

```bash
docker compose up -d postgres
```

- **Ghost run (heartbeat timeout)**
  - **Symptom**: `runs.finished_at IS NULL` and `last_heartbeat` stale; `reaper.log` reports cleanup.
  - **Cause**: child died hard (OOM, SIGKILL).
  - **Fix**: reaper will mark exit_code `-1` and release lock; investigate per-run log for last output.

- **Scraper returning 0 jobs**
  - **Symptom**: monitor warning “0 jobs scraped”.
  - **Cause**: selectors broken, network blocked, API changed, query too strict.
  - **Fix**: run scraper in headed mode and update selectors; for Jobright prefer API adapter.

### 7.3 Scoring calibration (M9)

Goal: use `labels` from the UI to tune the scoring weights and gate threshold.

Practical steps:

1. Run orchestrator for several days to accumulate jobs.
2. Use Review UI to label jobs yes/maybe/no (and track applied vs not applied).
3. Export labeled data to CSV using the calibration export script:

```bash
psql $DATABASE_URL -f scripts/storage/calibration-export.sql -A -F',' > labels.csv
```

This produces columns: `job_id`, `title`, `company`, `source`, `score_total`, `skills`, `semantic`, `yoe`, `seniority`, `location`, `judge_verdict`, `judge_bucket`, `user_label`, `notes`, `labeled_at`.

4. Query label vs score correlations inline:

```sql
SELECT
  l.label,
  COUNT(*) AS n,
  AVG(s.total) AS avg_score,
  AVG(CASE WHEN jv.verdict='STRONG' THEN 1 ELSE 0 END) AS pct_strong
FROM labels l
JOIN scores s ON s.job_id=l.job_id AND s.run_id=l.run_id
JOIN judge_verdicts jv ON jv.job_id=l.job_id AND jv.run_id=l.run_id
GROUP BY l.label
ORDER BY n DESC;
```

5. Adjust `config/config.json`:
   - weights to push “yes” jobs up, “no” jobs down
   - `scoring.gate_threshold` to control LLM spend

6. Exit criterion: top 10 jobs by `score_total` match “would apply” labels at ≥ 80% rate.

7. Re-run on cached JSONLs (`JSONL=...`) to validate changes without rescrape cost.

### 7.4 How to add a new job source

High-level plan:

- Add a scraper adapter that outputs canonical Job schema.
- Wire it into `scraper/cli.py` (`--source` choice).
- Ensure `scripts/run-pipeline.ts` understands any source-specific behavior (e.g., whether `description_raw` is pre-scraped).
- Add/extend orchestrator schedule if needed.
- Add tests + fixtures.

Concrete checklist:

- **Scraper**
  - Create `scraper/<source>.py` with `scrape(...) -> Iterator[dict]`.
  - Use `scraper/common/schema.py` → `make_empty_job(...)`.
  - Ensure `meta.job_id`, `meta.source_url`, `meta.run_id`, `meta.scraped_at` are set.
  - Add new `--source` option in `scraper/cli.py`.
- **Pipeline**
  - Confirm fetch behavior: if your scraper provides a real prose `description_raw`, ensure it exceeds the “pre-scraped” threshold (>= 200 chars) so fetch can be skipped.
  - Ensure `source` string is used consistently for Redis keys and DB writes.
- **Orchestrator**
  - Add schedule in `src/orchestrator/scheduler.ts` with `MAX`, `TTL`, and any `POSTED_WITHIN` analog (if applicable).
- **DB**
  - No schema changes required for new sources by default; `jobs.source` is free text.
- **UI**
  - UI will automatically show new `source` values in source badges/filters.

---

## 7.5 Known issues and accepted limitations

These are open items from THE-BIBLE-v7 §12 — accepted trade-offs, not bugs to fix right now.

| # | Issue | Detail | Status |
|---|---|---|---|
| 1 | **pgvector two-phase hash gate not landed** | `findSemanticDuplicate` runs the cosine query directly without a cheaper first-pass title/company hash filter. Low priority while volume stays under ~100 jobs/run. | Open |
| 2 | **Scoring not calibrated on real data** | Weights (0.35/0.25/0.15/0.15/0.10) and threshold (0.50) are designed values. M9 is done — calibration is now unblocked. See §7.3. | Active |
| 3 | **Ghost reaper misses <60s crashes** | If a run crashes before its first heartbeat (first 60s of execution), `last_heartbeat IS NULL` and the reaper's `IS NOT NULL` guard skips it. The `runs` row stays with `finished_at IS NULL` forever unless manually cleaned. Accepted: scraper + embedding load alone takes 10–20s, making sub-60s crashes rare. | Accepted |
| 4 | **Jobright session cookie rotation** | `jobright_api` relies on an authenticated session in `config/cookies/jobright_api.json`. If the scraper returns 0 jobs or auth errors, rotate cookies from browser extension. Never commit cookie files. | Operational |
| 5 | **OpenRouter credit exhaustion** | A 401 `User not found` causes every extraction to fail silently (jobs archive with `extraction_failed` flag). Monitor catches this and warns. At projected volume (~$0.50–1.00/day), $10 lasts 2–3 weeks. | Operational |
| 6 | **Jobright HTML scraper fragile** | `jobright.py` uses CSS-module hashed class names that break on Jobright frontend deploys. Primary path is `jobright_api.py`; HTML scraper is fallback only. | Accepted |

---

## 7.6 Roadmap

**Completed milestones** (from THE-BIBLE-v7 §13):

| Milestone | Description |
|---|---|
| M1 | scrape → filter → print |
| M2 | fetch → extract → pipeline |
| M3 | score → gate |
| M4 | Real-data validation (2026-04-23, Dice, 20 jobs) |
| M5 | LLM judge (WEAK/MAYBE/STRONG routing) |
| M6 | Cover letter generator (`.md` per job, run-scoped output) |
| M7 | Persistence: Postgres + pgvector + Redis; dedup wired |
| M8 | Orchestrator: node-cron + Redis lock + heartbeat + ghost reaper + monitor (2026-04-25) |
| M9 | Review UI at `localhost:3001` (2026-04-29): Apply Queue + Hard/Soft Rejections, labeling, note chips, application tracking |

**Active — Scoring calibration (M10 prerequisites):**

Collect ~50+ labeled jobs through the Review UI, then tune weights using `scripts/storage/calibration-export.sql`. Exit criterion: top 10 by score match "would apply" labels at ≥ 80%.

**Planned:**

- **M10 — Notification UI**: email digest / mobile push / web dashboard. Out of scope until the system runs unattended for 2+ weeks without manual intervention.
- **Profile-builder** (low priority): resume → `profile.json` automation. Hand-maintained for now.

---

## 8. Decision Log

This captures the major architectural decisions/deviations documented in `THE-BIBLE-v7.md` (carried forward).

### 8.1 Orchestration: BullMQ per-stage queues → run-level orchestration

- **Originally planned:** BullMQ queues per stage (scrape/filter/fetch/extract/score/judge/cover-letter).
- **Built instead:** node-cron + Redis lock + `child_process.spawn` of `scripts/run-pipeline.ts`.
- **Why:** Passing large in-memory artifacts (embeddings and text) through Redis between every stage is expensive; it breaks the `run_id`-scoped data model; and the pipeline already has concurrency and throttling (`pLimit(5)`, `throttle_ms`). Run-level orchestration adds the missing operational controls with far lower complexity.
- **When to revisit:** higher volume (1000+ jobs/run), multiple machines, need per-stage observability.

### 8.2 Lock value: `run_id` only (no PID)

- **Originally planned:** store PID in lock for diagnosis.
- **Built instead:** lock value is `run_id` only.
- **Why:** PID reuse makes it unreliable; TTL is the real safety net; `run_id` is enough for correlation.

### 8.3 Heartbeat + ghost reaper, not just exit code

- **Why:** Hard crashes may not write exit code or finish the run; heartbeat allows detection and cleanup within 5 minutes.

### 8.4 UI server behavior: cover letters read from disk

- **Constraint:** `cover_letters.content` is typically NULL; cover letters are written to disk.
- **Built:** UI server resolves from `file_path` (with historical path substitution).

---

## 8.5 Improvements over original plan (THE-BIBLE §11)

These are enhancements beyond what v1 specified — design decisions made during build that improved correctness or operability.

| # | Improvement | Why it matters |
|---|---|---|
| 11 | **Run-level orchestration with Option 2.5 hardening** | Base "just cron the pipeline" (Option 3) was extended with Redis lock, heartbeat+reaper, monitor, and SIGTERM forwarding — each targets a specific silent-failure mode Option 3 would miss. |
| 12 | **Separate log files per concern** | `orchestrator.log` (lifecycle + warnings), `reaper.log` (ghost sweeps), `runs/{run_id}.log` (child verbatim). Mixing all three would make the operational log unusable. Watch `orchestrator.log` daily; open others only when debugging. |
| 13 | **Monitor's `attempted > 5` guard** | Prevents false "low extraction rate" warnings when `EXTRACT=0` or all jobs are deduped before extraction (`extractions_attempted = 0`; naive `0/0 < 0.5` would fire). |
| 14 | **`REDIS_URL` read inside `getClient()`, not at module load** | Module-level constant capture broke Redis-down tests: the test pointed the env var at a dead port after import, but the lock used the original real URL. Moving the read inside `getClient()` makes the lock pick up the current env var on each connection attempt, fixing both tests and runtime env-change behavior. |
| 15 | **Extractor strict `json_schema` response format** | Switched from `json_object` to strict `json_schema` mode with a JSON Schema mirror of the Zod schema (`src/extractor/schema.ts`). Eliminates markdown-fence wrappers and missing-field model errors. Fallback: `EXTRACTOR_FORCE_JSON_OBJECT=1`. |
| 16 | **Global `SAVE_FIXTURES` cap** | Fixture counter seeds from existing `jd-real-###-*` files on disk, making the "max 5" cap global across runs rather than per-run. Prevents unattended mode from writing 5 new fixtures every cron tick forever. |
| 17 | **Labeling CLI + `labels` table for calibration** | `labels(job_id, run_id, label, notes, labeled_at)` and `src/storage/label-cli.ts` support fast manual ground-truth labeling (y/m/n/skip/quit). Foundation for weight calibration in the active M10 milestone. |

