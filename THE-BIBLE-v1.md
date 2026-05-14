# Job Filter Agent — The Bible

> Everything about this application. If you're joining — human, LLM, or agent — read this first.
> Last updated: 2026-04-17

---

## Table of Contents

1. [What this is](#1-what-this-is)
2. [Design principles](#2-design-principles)
3. [Architecture overview](#3-architecture-overview)
4. [Tech stack](#4-tech-stack)
5. [Pipeline — end to end](#5-pipeline--end-to-end)
6. [Data model](#6-data-model)
7. [LLM usage strategy](#7-llm-usage-strategy)
8. [Key design decisions](#8-key-design-decisions)
9. [Project status — what's built, what's not](#9-project-status--whats-built-whats-not)
10. [Module breakdown](#10-module-breakdown)
11. [Known issues and open decisions](#11-known-issues-and-open-decisions)
12. [Roadmap — what to build next](#12-roadmap--what-to-build-next)
13. [Onboarding — get running in 5 minutes](#13-onboarding--get-running-in-5-minutes)
14. [How to contribute](#14-how-to-contribute)
15. [Glossary](#15-glossary)
16. [Reference documents](#16-reference-documents)

---

## 1. What this is

A personal job-hunting automation for Sarath (6-YOE senior full-stack engineer, US-based, on OPT, New York/New Jersey area with willingness to relocate).

The app runs on a cron schedule — every 4 hours from 9am to 9pm daily — and does the following for each run:

1. Scrapes job postings from multiple sources (JobSpy-supported sites + Jobright)
2. Deduplicates them within and across sites
3. Filters them against Sarath's profile using a cheap deterministic hard-filter
4. Fetches full job descriptions for survivors
5. Extracts structured data from each JD using a small LLM
6. Scores each JD against the profile using deterministic rules + embedding similarity
7. Sends the top-scoring jobs to a larger LLM judge for nuanced evaluation
8. Generates a tailored cover letter for each `STRONG_MATCH` job
9. Persists everything for review

The goal: Sarath opens an app or a notification feed and sees, per run, a ranked shortlist of jobs he'd actually apply to, each with a pre-written cover letter ready to send.

### Target hardware

Medium-configuration old laptop. This is not running in a data center. Memory-conscious, CPU-conscious, single-node.

### Non-goals

- Not a SaaS product. Single-user.
- Not real-time. 4-hour cadence is fine.
- Not a general "job search platform." Opinionated around one resume.

---

## 2. Design principles

These are the non-negotiables. Everything downstream flows from here.

1. **LLM calls are expensive; deterministic code is free.** Every LLM call must earn its place. If a rule can decide something, it's a rule. The LLM is used for: one-time profile extraction, per-JD structured extraction, the final judge pass on pre-filtered candidates, and cover letter generation. Nothing else.

2. **The filter is pure.** `hardFilter` doesn't mutate inputs, doesn't do I/O, doesn't log. Same input, same output, forever. Easy to test, easy to reason about.

3. **Profile validation happens once, at load.** Invalid profile data is a config error, not runtime input. Filter functions can assume the profile is structurally valid.

4. **Unknown values on the job side flag, not reject.** Extractor failures happen. A job with a weird `location.type: "flexible"` shouldn't be silently rejected — it gets `remote_unclear` flagged and the LLM judge sees the uncertainty.

5. **Fixtures before fixes.** Every bug gets a fixture first, then a fix. The fixture prevents the bug from returning.

6. **Each pipeline stage is independently testable.** Scrape, filter, fetch, extract, score, judge — all have defined inputs and outputs, and can run in isolation against stored data.

7. **Scope discipline.** If something isn't in the current stage's spec, it belongs in another spec. No "while we're here" feature creep.

---

## 3. Architecture overview

### High-level data flow

```
┌──────────┐     ┌─────────┐     ┌────────────┐     ┌───────────┐     ┌─────────┐
│ Scheduler├────▶│ Scraper ├────▶│ Hard-filter├────▶│ JD fetch  ├────▶│ Extract ├─▶
│ (cron)   │     │ workers │     │            │     │           │     │ (LLM)   │
└──────────┘     └─────────┘     └────────────┘     └───────────┘     └─────────┘

   ┌────────┐     ┌────────┐     ┌──────────┐     ┌─────────┐     ┌──────────┐
─▶ │ Embed  ├────▶│ Dedup  ├────▶│ Normalize├────▶│ Score   ├────▶│ LLM judge│─▶
   │        │     │(pgvec) │     │ skills   │     │         │     │          │
   └────────┘     └────────┘     └──────────┘     └─────────┘     └──────────┘

                                                ┌──────────────┐     ┌────────┐
                                           ───▶ │ Cover letter ├────▶│ Store  │
                                                │ (LLM)        │     │        │
                                                └──────────────┘     └────────┘
```

### Module layout (when complete)

```
job-hunter/
├── job-filter/           ← BUILT. Hard-filter stage.
├── profile-builder/      ← Not built. Generates profile.json from resume.
├── scraper/              ← Not built. JobSpy wrapper + custom scrapers.
├── dedup/                ← Not built. Redis within-site + pgvector cross-site.
├── extractor/            ← Not built. JD → structured JSON via LLM.
├── embeddings/           ← Not built. Text → vector via hosted API.
├── scorer/               ← Not built. Deterministic job↔profile scoring.
├── judge/                ← Not built. LLM final evaluation.
├── cover-letter/         ← Not built. Resume + JD → tailored letter.
├── orchestrator/         ← Not built. BullMQ queues, scheduler, retry.
├── storage/              ← Not built. Postgres + pgvector + Redis.
└── shared/               ← Not built. skill-aliases.json, shared types.
```

---

## 4. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Core runtime | Node.js (v22, TypeScript) | Async I/O is the core workload; user's preference. |
| Scraping fallback | Python (JobSpy via subprocess) | JobSpy already handles LinkedIn/Indeed/Glassdoor/Ziprecruiter/Google. Reinventing those adapters is weeks of work. |
| Queue | BullMQ on Redis | Retries, backpressure, cron support, concurrency limits. |
| Storage — structured | Postgres + pgvector | Unified SQL filtering + vector similarity. Cross-site dedup is a hybrid query. |
| Storage — ephemeral | Redis | Queue backing + within-site exact-match dedup SET with TTL. |
| LLM provider | Hosted (Anthropic Claude or equivalent) | Local LLMs on a medium laptop won't produce useful extraction quality. |
| Embeddings | Hosted (OpenAI `text-embedding-3-small` or Voyage) | Must be consistent across the DB; one provider, one model, pinned. |
| Testing | Vitest | Fast, first-class TS support. |
| Scheduler | `node-cron` in-process | No need for a separate service on a single-node setup. |

### What we deliberately did NOT choose

- **LangGraph / RAG frameworks.** This is a scheduled ETL pipeline, not an agent. Adding graph orchestration buys ceremony without buying capability. RAG has no corpus to retrieve from — the profile is one document.
- **Local LLMs.** "Medium laptop" + "useful extraction quality from JDs" don't coexist today.
- **Pure-JS scraping.** We'd rewrite JobSpy's site adapters. Not worth it.
- **A cloud queue (SQS, Cloud Tasks).** Single-node workload; Redis does this in-process.
- **MongoDB / DynamoDB.** Vector search is first-class in pgvector; no reason to introduce a second store.

---

## 5. Pipeline — end to end

For each scheduled run (every 4 hours between 9am and 9pm):

### Stage 0 — Run initialization
- Generate a `run_id` (UUID).
- Capture `nowIso` — a single timestamp used by all staleness checks in this run.
- Load `profile.json` and `skill-aliases.json` into memory.
- Run `validateProfile()` — crash the run if profile is invalid.

### Stage 1 — Scrape
- Enumerate enabled sources (JobSpy-backed sites, Jobright, etc.).
- For each: fetch recent postings, apply a recency cap (posts newer than N days) and a count cap (max M per source).
- Normalize each scraped posting into the `Job` schema (§6).
- Each scraper is a worker consuming from the `scrape` queue.

### Stage 2 — Within-site exact dedup
- For each scraped job, check Redis: `SISMEMBER seen:{source}:{day} {canonical_job_id}`.
- If present, drop. If absent, `SADD` with a 7-day TTL.
- This stage is free — in-memory Redis ops.

### Stage 3 — Sanitize
- Run `sanitizeJob()` — nulls out suspect `source_score` values, flags anomalies.

### Stage 4 — Hard filter
- Run `hardFilter(job, profile)`.
- REJECTs are persisted with reason and dropped.
- PASSes move to stage 5. Flags accumulate on the job.

### Stage 5 — JD fetch
- HTTP GET the job's `source_url`, extract body text into `description_raw`.
- Respect robots.txt, set a realistic User-Agent, implement polite delays per domain.
- Persist raw HTML + extracted text alongside the job record.

### Stage 6 — Post-fetch checks
- Run `postFetchChecks(job, nowIso)`.
- Adds flags: `education_unparsed`, `posted_at_missing`, `stale_posting`.

### Stage 7 — Structured extraction
- Small-LLM call converts `description_raw` into the `Job` schema's structured fields (skills, YOE, education, responsibilities).
- Uses citation-based extraction: every field has a supporting quote, verified as substring.
- Pin the model and prompt version on every record for future re-extraction.

### Stage 8 — Embedding
- Embed the free-text portions (`responsibilities` + `description_raw` sections) with a hosted embedding API.
- Store as a `vector` column in Postgres.

### Stage 9 — Cross-site semantic dedup
- Cheap gate: hash `(normalized_company + normalized_title)`. Same hash = candidate duplicate.
- For candidates, run a pgvector HNSW similarity query over the last 7 days of embeddings.
- Threshold: cosine ≥ 0.88 → duplicate. Keep the "best" source (configurable rank).

### Stage 10 — Skill normalization
- For each survivor, normalize `required_skills[].name` through `skill-aliases.json`.
- Output: lowercase canonical skill names.

### Stage 11 — Deterministic scoring
- Compute a `[0, 1]` score with a weighted breakdown:
  - Skill overlap (weighted Jaccard by importance × confidence)
  - Years of experience fit (asymmetric — underqualified is worse than overqualified)
  - Seniority match (ordinal distance)
  - Location compatibility (binary-ish, softened by `willing_to_relocate`)
  - Semantic fit (cosine of JD responsibilities embedding × profile summary embedding)
- Store the full breakdown, not just the number.

### Stage 12 — Threshold gate
- Jobs below a threshold (configurable, start ~0.60) skip the LLM judge and go to `BUCKETS.ARCHIVE`.
- Jobs above the threshold proceed to the LLM judge.
- **This is the main LLM-cost lever.** See §7 and §11 for the open design question.

### Stage 13 — LLM judge
- Larger-model call with the full job context + profile context + deterministic score + breakdown.
- Returns `verdict` (STRONG/POSSIBLE/WEAK), `confidence`, `key_matches`, `gaps`, `why_apply`, `flags_noted`.
- Retry with exponential backoff on transient failures; permanent failure sets `JUDGE_FAILED` flag and routes job to review queue.

### Stage 14 — Routing
Per the §10 table in design-v4.md:

| Verdict | Confidence | Bucket |
|---|---|---|
| STRONG_MATCH | ≥ 0.70 | COVER_LETTER + RESULTS |
| STRONG_MATCH | < 0.70 | RESULTS |
| POSSIBLE_MATCH | any | REVIEW_QUEUE |
| WEAK_MATCH | any | ARCHIVE |

### Stage 15 — Cover letter
- For STRONG_MATCH + confidence ≥ 0.70 only.
- Larger-model call with resume + JD + match reasoning from the judge.
- Stored alongside the job record.

### Stage 16 — Notify / display
- Out of scope for now; results live in Postgres. UI layer is a future decision.

---

## 6. Data model

The full schemas live in `job-filter/src/types.ts`. Summaries:

### Job (what a scraped+extracted posting looks like)

```ts
{
  meta: { job_id, schema_version, source_site, source_url,
          source_score, posted_at, scraped_at, run_id, flags },
  title, seniority, employment_type,
  company: { name, type },
  location: { type, timezone, cities, countries },
  compensation: { min, max, currency, interval },
  required_skills: [{ name, years_required, importance, category }],
  years_experience: { min, max },
  education_required: { minimum, field },
  visa_sponsorship, security_clearance, domain,
  responsibilities, description_raw
}
```

### Profile (Sarath's structured preferences — one file, versioned)

```ts
{
  meta: { profile_id, schema_version, version, last_updated },
  target_titles,
  acceptable_seniority, acceptable_employment,
  location: { current_city, current_country, timezone,
              acceptable_types, acceptable_cities, acceptable_countries,
              willing_to_relocate },
  compensation: { min_acceptable, currency, interval },
  skills: [{ name, years, confidence, category }],
  years_experience,
  education: { degree, field },
  work_authorization: { requires_sponsorship, visa_type, clearance_eligible },
  preferred_domains, deal_breakers
}
```

### The job↔profile mapping

See design-v4.md §3 for the field-by-field mapping table.

---

## 7. LLM usage strategy

This is the main cost driver. Enumerate explicitly.

| Stage | Model size | Calls per run | Notes |
|---|---|---|---|
| Profile extraction | Larger | 0 per run (one-time) | Re-run only when resume updates. |
| JD extraction | Small | ~300–400 | Biggest volume. Use smallest capable model. |
| Scoring | None | 0 | Deterministic code. |
| Dedup | None | 0 | Embeddings + threshold. |
| Judge | Larger | ~50–150 (post-threshold gate) | Cuts from ~400 → ~100 via threshold. |
| Cover letter | Larger | ~10–30 | Only STRONG_MATCH + confidence ≥ 0.70. |

**Estimated per-run: ~300–400 small calls + ~60–180 larger calls. 4× per day.**

At Haiku-class + Sonnet-class pricing, rough envelope is single-digit dollars per day. Tunable via:
- Threshold tightening before the judge stage (biggest lever)
- Tighter pre-filter rules
- Smaller extraction model
- Aggressive caching on JD extractions (re-extract only when prompt version changes)

---

## 8. Key design decisions

### Decision 1: No LangGraph, no RAG
This is a pipeline, not an agent. Decisions are known in advance. `for` loops and queues are more reliable and cheaper than tokens for control flow.

### Decision 2: Filter is pure, validation is upfront
`hardFilter` takes a job and profile, returns `{verdict, reason, flags}`. No mutation. Profile is validated once at load; invalid profile = thrown exception, not a runtime filter failure.

### Decision 3: Unknown job values flag, don't reject
Extractor failures ("flexible" as a location type, unknown clearance level, null employment type) should not cause false rejects. They set flags and let the LLM judge resolve.

### Decision 4: Deterministic scoring, not LLM-based
Once both sides are structured JSON, the LLM has nothing to contribute to scoring. Code is faster, cheaper, deterministic, and debuggable. LLM judges borderline cases only.

### Decision 5: Cross-site dedup is semantic, within-site dedup is exact
Same URL/ID from the same site → drop immediately via Redis SET. Same-role-different-site is harder: cheap hash gate (`company+title`), then embedding similarity ≥ 0.88 confirms.

### Decision 6: Fixtures define behavior
`job-filter` ships with 44 JSON fixtures. Every reject reason, every flag, every edge case has a fixture. New bugs get a fixture first.

### Decision 7: FX is hardcoded, not live
Coarse filter; max-of-range absorbs ~2% weekly drift on majors. Updating means editing a constant and shipping. Not a cron-refreshed table.

### Decision 8: Node + Python subprocess, not pure Node
JobSpy is Python and handles 5+ sites. Shelling out is pragmatic; rewriting is not.

### Decision 9: Single-user, single-node
No auth, no multi-tenant concerns, no cloud orchestration. Runs on a laptop. Deploy story: `git pull && npm start`.

### Decision 10: Cover letter uses larger model
Volume is tiny (~10–30/day), quality matters. This is the one place where not skimping on model size matters.

For fuller rationale on any of these, see design-v4.md.

---

## 9. Project status — what's built, what's not

### Built and tested

| Module | Status | Location | Tests |
|---|---|---|---|
| Design doc (v4) | ✅ Locked | `design-v4.md` | N/A |
| Hard filter | ✅ Green | `job-filter/src/filter.ts` | 33 fixtures |
| Profile validation | ✅ Green | `job-filter/src/validate.ts` | 14 cases |
| Job sanitization | ✅ Green | `job-filter/src/sanitize.ts` | 4 fixtures |
| Post-fetch checks | ✅ Green | `job-filter/src/post-fetch.ts` | 7 fixtures |
| Skill normalization | ✅ Green (unused) | `job-filter/src/skills.ts` | (via type checks) |
| Compensation utils | ✅ Green | `job-filter/src/compensation.ts` | (via filter fixtures) |
| Constants / enums | ✅ | `job-filter/src/constants.ts` | N/A |
| Types | ✅ | `job-filter/src/types.ts` | N/A |
| Purity tests | ✅ Green | `job-filter/test/purity.test.ts` | 4 cases |
| Sarath's profile | ✅ Validated | `profile.json` | validates against `validateProfile` |

**Test suite: 62/62 passing. TypeScript: clean typecheck.**

### Designed but not built

| Component | Design status | Notes |
|---|---|---|
| Deterministic scoring layer | Specified in design-v4.md §0 as out-of-scope for filter doc | Needs its own mini-spec + decision on gate-vs-score |
| Orchestrator / BullMQ queues | Sketched in §5 of this doc | Specific queue shapes TBD |
| Storage schema | Sketched | Postgres tables + pgvector columns TBD |

### Not built, not designed

- Scraper module (JobSpy subprocess + any custom scrapers)
- JD fetcher (HTTP + HTML extraction to plaintext)
- Structured extractor (LLM → schema)
- Embedding generation client
- Dedup module (Redis + pgvector)
- LLM judge (prompt + retry policy)
- Cover letter generator
- Results storage
- Profile builder (resume → profile.json, done manually for v1)
- Skill alias map (`skill-aliases.json`)
- Notification / review UI

---

## 10. Module breakdown

### `job-filter/` — BUILT

The hard-filter stage. Pure-function module with extensive fixtures.

**Files:**
- `src/constants.ts` — level maps, enums, FLAGS, BUCKETS, FX table
- `src/types.ts` — Job, Profile, FilterResult types
- `src/validate.ts` — `validateProfile()` — throws on invalid config
- `src/sanitize.ts` — `sanitizeJob()` — clamps suspect values
- `src/filter.ts` — `hardFilter()` — the pure-function core
- `src/post-fetch.ts` — `postFetchChecks()` — flags from description_raw + posted_at
- `src/skills.ts` — `normalizeSkill()` — canonical name lookup
- `src/compensation.ts` — `toAnnualUSD()`, `applySourceScore()`
- `src/index.ts` — public exports

**Fixtures:** `fixtures/hard-filter/` (33), `fixtures/sanitize/` (4), `fixtures/post-fetch/` (7)

**Tests:** `test/fixtures.test.ts`, `test/validate.test.ts`, `test/purity.test.ts`

**To run:** `cd job-filter && npm install && npm test`

### `profile.json` — BUILT (for Sarath)

Structured representation of the resume + preferences. 53 skills, 7 target titles, 2 deal-breakers (no_sponsorship, clearance_required).

Generated from resume text by hand for v1. A `profile-builder` module would automate this later.

### `scraper/` — TODO

Wraps JobSpy (Python subprocess) for LinkedIn, Indeed, ZipRecruiter, Glassdoor, Google Jobs. Custom scraper for Jobright (JobSpy doesn't cover it).

Output: `Job` objects written to the `scrape` queue.

Key concerns:
- Recency cap (last N days) + count cap (max M per source) per run
- Polite rate limiting (per-domain delays)
- Robots.txt compliance
- Realistic User-Agent
- Error recovery (one failing source doesn't kill the run)

### `extractor/` — TODO

Takes `description_raw` → structured `Job` fields via LLM.

Key features:
- JSON schema enforcement (tool use or JSON mode)
- Citation-based extraction (each field has a quote verified as substring)
- "Extract, don't infer" prompting (null if not stated)
- Section-aware input chunking (separate requirements vs responsibilities)
- Model/prompt version pinned per record
- Zod (or equivalent) validation on response, retry once on validation failure

### `embeddings/` — TODO

Simple client wrapping a hosted embedding API. Inputs a string, returns a normalized vector. Stores in Postgres `vector` columns.

Pin the embedding model in config. Changing the model invalidates all stored embeddings — that's a re-embed migration, explicitly.

### `dedup/` — TODO

Two components:

1. **Within-site** — Redis SET with TTL. `SISMEMBER` before adding. O(1).
2. **Cross-site** — two-phase:
   - Cheap: hash `(normalized_company + normalized_title)` → candidate set.
   - Expensive: pgvector cosine similarity ≥ 0.88 → confirmed duplicate.

### `scorer/` — TODO

Deterministic scoring. See §7 in this doc and §10 of design-v4.md for the downstream contract.

**Still undecided:** whether scoring produces (a) a 0–1 number plus every job still goes to the LLM judge, or (b) a gate that drops sub-threshold jobs before the judge sees them. Choice (b) is cheaper; choice (a) is safer while tuning. See §11.

### `judge/` — TODO

LLM-based final evaluation. Payload and response contract defined in design-v4.md §10.

**Undefined (must be designed):**
- Exact system prompt (rubric, flag handling, format enforcement)
- Temperature (should be 0)
- Retry + fallback policy
- Rate limiting (must coordinate with BullMQ concurrency)

This is the single most important undefined module for output quality. Spend time here.

### `cover-letter/` — TODO

Larger-model generation. Input: resume (plain text) + JD + judge's `key_matches` and `why_apply`. Output: ~250–400 word cover letter.

Separate prompt from the judge. This is where model quality matters most; use the best available model.

### `orchestrator/` — TODO

BullMQ queues, worker processes, `node-cron` scheduler.

Queue shape (current thinking):
- `scrape` — one job per source per run
- `filter` — one job per scraped job
- `fetch` — one job per filter-PASS
- `extract` — one job per fetched JD
- `score` — one job per extracted JD
- `judge` — one job per scored candidate above threshold
- `cover-letter` — one job per STRONG_MATCH + confidence ≥ 0.70

Concurrency limits per queue to respect LLM rate limits.

### `storage/` — TODO

Postgres schema (draft):
- `runs(run_id, started_at, finished_at, profile_id, profile_version)`
- `jobs(job_id, run_id, source_site, source_url, meta jsonb, extracted jsonb, embedding vector, description_raw text, ...)`
- `filter_results(job_id, verdict, reason, flags jsonb)`
- `scores(job_id, total, breakdown jsonb, scored_at)`
- `judgments(job_id, verdict, confidence, key_matches jsonb, gaps jsonb, why_apply, flags_noted jsonb)`
- `cover_letters(job_id, content, generated_at, model)`

Indexes on `jobs.run_id`, `jobs.posted_at`, `judgments.verdict`, pgvector HNSW on embeddings.

Redis keys:
- `seen:{source}:{YYYYMMDD}` — SET of canonical job IDs for within-site dedup (7d TTL)
- BullMQ queue keys (auto-managed)

---

## 11. Known issues and open decisions

### Decisions you need to make before the affected module can ship

1. **Gate vs score for the deterministic scoring layer (CRITICAL).** Does the scorer produce a number that's only context for the LLM judge, or does it also gate jobs below a threshold from ever reaching the judge? Gate cuts LLM cost ~70%; score-only is safer while the scoring function is still being tuned. **Recommended: start with score-only, tighten to gate once the score is trustworthy on 50+ manually labeled jobs.**

2. **Scraping ethics / ToS.** LinkedIn in particular is aggressive about scraping. JobSpy handles this somewhat, but there's no risk-free answer. Personal-use single-account tolerated in practice; commercial use is not. **Recommended: personal use only, no distribution, respect robots.txt and rate limits.**

3. **Profile preferences that aren't facts.** Sarath's profile.json contains inferences (visa_type: OPT, min_acceptable: 110000) that came from reading between lines. These should be confirmed periodically — especially when visa status changes (H1B transition, GC progress).

4. **Additional deal_breakers.** Current set is `[no_sponsorship, clearance_required]`. Candidates for addition (pending Sarath's call): `unpaid_overtime`, `on_call_required`, `third_party_contract`, `equity_only_compensation`, `defense_industry`, `gambling`, `crypto`.

### Known technical debt

1. **No scraper yet, so the filter's real-world behavior is unverified.** Fixtures are synthetic. Real scraped jobs will likely surface 3–10 new fixtures in the first day of running (new location strings, weird employment types, unicode in titles, HTML artifacts in descriptions).

2. **`normalizeSkill` has no alias map to consume.** Currently just lowercases. The real canonical skill aliases file doesn't exist. Until it does, scoring will treat `js` and `javascript` as different skills.

3. **No embedding model chosen.** The choice affects cost, quality, dimension size, and DB schema. Must be pinned before any vectors are stored.

4. **No LLM provider chosen.** Probably Anthropic for coherence with this project, but the extractor prompt must be written against a specific model with specific JSON-mode guarantees.

5. **Schema version bumps have no migration story.** If we change the Job or Profile schema, existing stored records are left in an ambiguous state. Needs a policy.

6. **posted_at parsing is brittle.** `Date.parse()` handles ISO but not relative strings ("2 days ago") or site-specific formats. Each scraper must normalize its own site's format before writing. This responsibility isn't documented anywhere yet.

7. **FX rates are stale by design.** Acceptable for coarse filtering, but flag any user who tries to use this for non-USD primary markets.

---

## 12. Roadmap — what to build next

Prioritized. Build in order. Each step produces something runnable end-to-end.

### Milestone 1 — End-to-end walking skeleton (next 3–5 focused sessions)

**Goal:** scrape one site, filter real jobs, print results. No LLM yet, no storage.

1. **`scraper/` — JobSpy subprocess wrapper for Indeed only.** Indeed is JobSpy's best-supported source. Output: array of `Job` objects matching our schema. Count cap 50, recency cap 3 days.
2. **Adapt raw JobSpy output to the `Job` schema.** This will surface the first real-world mismatches. Write fixtures as you find them.
3. **Wire `scrape → sanitize → hardFilter` into a simple CLI.** No queue yet. `npm run scrape:indeed` prints filter results.
4. **Capture 5–10 sample jobs as JSON for regression testing.** These become the first non-synthetic fixtures.

Exit criterion: `npm run scrape:indeed` returns 50 jobs, filter classifies them, you look at the output and say "yeah, roughly right."

### Milestone 2 — JD fetch and extraction

**Goal:** Fill in the structured fields the scraper couldn't populate.

5. **`fetcher/` — HTTP + HTML-to-text.** Simple. Handle 403s, timeouts.
6. **Choose LLM provider and model.** Pin in config.
7. **`extractor/` — prompt design.** JSON schema, citation-based extraction, validation. Ship with a fixture suite of 10 real JDs and their expected extractions.
8. **`postFetchChecks` wired in after fetch + extract.**

Exit criterion: `npm run scrape:indeed --extract` writes 50 JSON files with full structured data. Eyeball-verify 10 of them.

### Milestone 3 — Scoring + judge (the product)

9. **Scoring function design.** Write the spec as a short doc. Decide gate-vs-score.
10. **`scorer/` implementation.** Deterministic, testable, debuggable. Ship with 20 fixtures.
11. **Manual labeling pass.** Take 30 real scraped+extracted jobs, manually rank "would apply / maybe / no." Tune scoring weights against this.
12. **`judge/` prompt and module.** Fixture-driven: 10 real cases with expected verdicts.
13. **Retry + fallback for judge failures.**

Exit criterion: for 50 real jobs, the top 10 by score are jobs you'd actually apply to.

### Milestone 4 — Storage and dedup

14. **Postgres schema + migrations.** Local Postgres in Docker.
15. **pgvector setup.**
16. **Embeddings client + wiring.** Re-run extraction and generate embeddings for stored jobs.
17. **Within-site dedup (Redis SET).**
18. **Cross-site dedup (hash gate + pgvector similarity).**

Exit criterion: two consecutive runs with overlapping results should deduplicate correctly.

### Milestone 5 — Cover letter + cron

19. **Cover letter prompt and module.**
20. **BullMQ queues + workers.**
21. **`node-cron` scheduler wired.**
22. **First unattended run.**

Exit criterion: leave it running for a day. Come back, find ranked jobs with cover letters.

### Milestone 6 — More sources, operational hardening

23. Additional scrapers (Jobright, LinkedIn via JobSpy, Glassdoor).
24. Rate-limiting and politeness improvements.
25. Observability: run logs, cost tracking, failure dashboards.
26. (Optional) A minimal UI to review results and mark outcomes.

---

## 13. Onboarding — get running in 5 minutes

### Prerequisites
- Node.js v22+
- npm v10+

### Get the code running

```bash
# Extract the tarball or clone the repo
cd job-filter

# Install dependencies
npm install

# Run the full test suite
npm test

# You should see: Test Files  3 passed (3) / Tests  62 passed (62)
```

### Validate the profile

```bash
npx tsx test/validate-generated-profile.ts
# Output: ✓ profile.json is valid
```

### Project layout at a glance

```
job-filter/
  src/               ← all production code
  fixtures/          ← JSON test cases, organized by module
    hard-filter/     ← 33 fixtures covering every reject and flag
    sanitize/        ← 4 fixtures for source_score validation
    post-fetch/      ← 7 fixtures for description_raw + posted_at
  test/              ← test runners + helpers
  profile.json       ← the user's profile
  design-v4.md       ← the authoritative filter design doc
  README.md          ← short-form project doc
THE-BIBLE.md         ← this file
```

### If you're here to add a feature

1. Write fixtures first, expecting them to fail.
2. Run `npm test` — see them fail.
3. Implement the change.
4. Run `npm test` — see them pass.
5. Run `npx tsc --noEmit` — confirm no type errors.

### If you're here to debug

- Filter behavior: start at `src/filter.ts`, find the matching rule by reject reason or flag name. Every rule corresponds to a fixture.
- Validation failures: `src/validate.ts`. Error messages name the field.
- Unexpected flag: search fixtures for the flag name. There's a fixture per flag.

---

## 14. How to contribute

### The workflow

1. **Read this doc and `design-v4.md` before writing code.**
2. **Fixture-first.** If you're fixing a bug or adding a rule, a fixture captures it first.
3. **Keep `hardFilter` pure.** No mutation, no I/O, no logging. If you think you need those, you're in the wrong module.
4. **Scope discipline.** If your change crosses module boundaries, split the PR.
5. **Run `npm test` before committing.** The suite is fast (~3s).

### Coding conventions

- TypeScript strict mode, no `any` in production code.
- Prefer small pure functions over classes.
- JSON over bespoke formats for configuration and fixtures.
- Config-driven tunables (thresholds, weights, caps) — never hardcoded.

### When to update this file

Update `THE-BIBLE.md` when:
- A module moves between status columns (TODO → built, etc.)
- A design decision changes
- A new top-level module is added
- A known issue is fixed (or a new one found)

Don't update it for individual bug fixes — those live in module-specific change logs.

---

## 15. Glossary

- **Hard filter** — the deterministic, rule-based stage that rejects jobs using listing metadata only. Does not look at JD text.
- **JD (job description)** — the full body of a job posting, fetched separately from the listing.
- **PASS / REJECT** — the two outcomes of `hardFilter`.
- **Flag** — a soft signal attached to a job meta, indicating ambiguity or noteworthy state. Flags do not reject; the LLM judge considers them.
- **Pipeline stage** — one named step in the overall flow (scrape, filter, extract, etc.).
- **Deterministic scoring** — a 0–1 number produced by code (not LLM) from structured fields + embedding similarity.
- **LLM judge** — the stage that takes pre-scored jobs and returns a nuanced verdict (STRONG/POSSIBLE/WEAK + confidence + reasoning).
- **Bucket** — the final destination of a job: COVER_LETTER, RESULTS, REVIEW_QUEUE, or ARCHIVE.
- **Run** — one execution of the pipeline, scheduled every 4 hours.
- **Fixture** — a JSON test case specifying inputs and expected outputs for a specific module.
- **JobSpy** — third-party Python library that wraps scrapers for LinkedIn, Indeed, ZipRecruiter, Glassdoor, Google Jobs.

---

## 16. Reference documents

- **`design-v4.md`** — the authoritative hard-filter design. Schemas, rules, utilities, pipeline contract. Read this before modifying the filter.
- **`job-filter/README.md`** — short-form module doc, setup and fixture format.
- **`profile.json`** — Sarath's structured profile. Generated from the resume, manually refined.
- **`job-filter/fixtures/`** — 44 JSON fixtures. These are the behavior spec.

Previous design doc versions (v1, v2, v3) and their review rounds are superseded and should not be referenced except historically.

---

**End of bible. If something in this doc disagrees with the code, the code wins and this doc gets updated. If something in the code disagrees with `design-v4.md`, that's a bug — one of them is wrong.**
