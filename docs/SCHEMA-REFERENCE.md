# Database Schema Reference — job-hunter (Section 5)

This document describes the Postgres schema created by `migrations/*.sql`.

> All migrations are **idempotent** (safe to re-run). The UI server (`scripts/ui-server.ts`) runs migration 004 on startup.

## Overview

- Extension: `vector` (pgvector)
- Primary “unit of work”: a **run** (`runs.run_id`)
- Most tables are keyed by `(job_id, run_id)` to preserve per-run job snapshots.

---

## Table: `runs`

**Purpose:** One row per pipeline execution. Orchestrator adds supervision fields (heartbeat + exit code).

**Created/altered by:**
- `migrations/001_initial.sql` (base columns)
- `migrations/002_orchestrator.sql` (supervision columns + partial index)

| Column | Type | Nullable | Default | Meaning |
|---|---|---:|---|---|
| `run_id` | `TEXT` | no | — | Primary key; propagated to all related tables and output directories |
| `source` | `TEXT` | no | — | Source name (e.g. `dice`, `jobright_api`, `linkedin`) |
| `started_at` | `TIMESTAMPTZ` | no | `NOW()` | Start timestamp |
| `finished_at` | `TIMESTAMPTZ` | yes | — | Finish timestamp; NULL while running |
| `jobs_total` | `INT` | yes | — | Total scraped jobs read from JSONL |
| `jobs_passed` | `INT` | yes | — | Hard filter PASS count (excluding REJECT/DEDUP) |
| `jobs_gated` | `INT` | yes | — | Gate-pass count (score ≥ gate threshold) |
| `jobs_covered` | `INT` | yes | — | Cover letters written count (paths present) |
| `exit_code` | `INT` | yes | — | Child pipeline exit code; NULL while running; `-1` for ghost-reaped |
| `last_heartbeat` | `TIMESTAMPTZ` | yes | — | Updated every 60s by orchestrator runner while child alive |
| `extractions_attempted` | `INT` | yes | `0` | Jobs where extraction was attempted (`ok` or `error`) |
| `extractions_succeeded` | `INT` | yes | `0` | Jobs where extraction returned `ok` |

**Primary key:** `run_id`

**Indexes:**

- `runs_unfinished_idx` on `(last_heartbeat)` **WHERE `finished_at IS NULL`**
  - Supports ghost reaper query efficiently.

**Written by:**

- Pipeline: `src/storage/persist.ts` → `saveRun()`, `finishRun()`
- Orchestrator runner: `src/orchestrator/runner.ts` (inline SQL) updates `last_heartbeat` and `exit_code`
- Ghost reaper: `src/orchestrator/scheduler.ts` (inline SQL) sets `exit_code=-1`, `finished_at=NOW()`

**Example row (fake but realistic):**

```json
{
  "run_id": "manual-3a6a0e2f-7b4a-4b3a-9f56-3c9c2ccf0f55",
  "source": "dice",
  "started_at": "2026-04-29T20:00:00.000Z",
  "finished_at": "2026-04-29T20:17:12.000Z",
  "jobs_total": 50,
  "jobs_passed": 12,
  "jobs_gated": 7,
  "jobs_covered": 3,
  "exit_code": 0,
  "last_heartbeat": "2026-04-29T20:16:00.000Z",
  "extractions_attempted": 10,
  "extractions_succeeded": 9
}
```

---

## Table: `jobs`

**Purpose:** Per-run job snapshot: scraped metadata, fetched JD, extracted fields, and optional embedding vector for semantic operations.

**Created by:** `migrations/001_initial.sql`

| Column | Type | Nullable | Meaning |
|---|---|---:|---|
| `job_id` | `TEXT` | no | Source-specific stable identifier |
| `run_id` | `TEXT` | no | Run foreign key → `runs(run_id)` |
| `source` | `TEXT` | no | Source name |
| `source_url` | `TEXT` | yes | Apply URL / listing URL |
| `title` | `TEXT` | yes | Job title |
| `company` | `TEXT` | yes | Company name |
| `posted_at` | `TIMESTAMPTZ` | yes | Listing posted date (best effort) |
| `scraped_at` | `TIMESTAMPTZ` | yes | Time scraped |
| `description_raw` | `TEXT` | yes | Plain-text JD (fetched or synthesized) |
| `meta` | `JSONB` | yes | Raw metadata blob from scraper and pipeline |
| `extracted` | `JSONB` | yes | Extracted fields snapshot |
| `embedding` | `VECTOR(384)` | yes | bge-small-en-v1.5 embedding |

**Primary key:** `(job_id, run_id)`

**Foreign key:** `(run_id) REFERENCES runs(run_id) ON DELETE CASCADE`

**Indexes:**

- `jobs_run_idx` on `(run_id)`
- `jobs_source_idx` on `(source)`
- `jobs_posted_idx` on `(posted_at)`
- `jobs_embedding_hnsw` using `hnsw (embedding vector_cosine_ops)` with `(m=16, ef_construction=64)`

**Written by:** pipeline persistence `src/storage/persist.ts` → `saveJob()`

**Read by:**

- UI queries (via joins)
- pgvector dedup query uses `embedding`

**Example row:**

```json
{
  "job_id": "dice-12345678",
  "run_id": "manual-...",
  "source": "dice",
  "source_url": "https://www.dice.com/job-detail/abc123",
  "title": "Senior Java Engineer",
  "company": "Acme Bank",
  "posted_at": "2026-04-28T12:00:00.000Z",
  "scraped_at": "2026-04-29T20:01:00.000Z",
  "description_raw": "Responsibilities...\nRequirements...",
  "meta": { "source_site": "dice", "flags": ["posted_at_missing"] },
  "extracted": { "required_skills": [ { "name": "java", "importance": "required" } ] },
  "embedding": "[384-float-vector]"
}
```

---

## Table: `filter_results`

**Purpose:** Hard filter verdict (PASS/REJECT/DEDUP) + reasons + flags.

**Created by:** `migrations/001_initial.sql`

| Column | Type | Nullable | Meaning |
|---|---|---:|---|
| `job_id` | `TEXT` | no | FK to `jobs` |
| `run_id` | `TEXT` | no | FK to `jobs` |
| `verdict` | `TEXT` | no | `REJECT \| PASS \| DEDUP` |
| `reason` | `TEXT` | yes | Reject reason (or dedup reason) |
| `flags` | `JSONB` | no | Array of flag strings |

**Primary key:** `(job_id, run_id)`

**Foreign key:** `(job_id, run_id) REFERENCES jobs(job_id, run_id) ON DELETE CASCADE`

**Written by:** pipeline persistence `saveJob()`

---

## Table: `scores`

**Purpose:** Deterministic scoring breakdown and total.

**Created by:** `migrations/001_initial.sql`

| Column | Type | Nullable | Meaning |
|---|---|---:|---|
| `job_id` | `TEXT` | no | FK to jobs |
| `run_id` | `TEXT` | no | FK to jobs |
| `total` | `FLOAT` | no | Composite score \(0..1\) |
| `skills` | `FLOAT` | yes | Skills component |
| `semantic` | `FLOAT` | yes | Semantic component |
| `yoe` | `FLOAT` | yes | YOE component |
| `seniority` | `FLOAT` | yes | Seniority component |
| `location` | `FLOAT` | yes | Location component |
| `scored_at` | `TIMESTAMPTZ` | no | `NOW()` | Score timestamp |

**Primary key:** `(job_id, run_id)`

**Written by:** pipeline persistence `saveJob()` (when scoring ran)

---

## Table: `judge_verdicts`

**Purpose:** LLM judge verdict and bucket routing results.

**Created by:** `migrations/001_initial.sql`

| Column | Type | Nullable | Default | Meaning |
|---|---|---:|---|---|
| `job_id` | `TEXT` | no | — | FK to jobs |
| `run_id` | `TEXT` | no | — | FK to jobs |
| `verdict` | `TEXT` | yes | — | `STRONG \| MAYBE \| WEAK` |
| `bucket` | `TEXT` | yes | — | `COVER_LETTER \| RESULTS \| REVIEW_QUEUE \| ARCHIVE` |
| `reasoning` | `TEXT` | yes | — | 1–3 sentence reasoning |
| `concerns` | `JSONB` | no | `'[]'` | list of concerns |
| `model` | `TEXT` | yes | — | model name (currently not always populated) |
| `judged_at` | `TIMESTAMPTZ` | no | `NOW()` | judge timestamp |

**Primary key:** `(job_id, run_id)`

**Written by:** pipeline persistence `saveJob()` (when judge ran)

---

## Table: `tailored_resumes`

**Purpose:** Metadata for generated tailored resume artifacts (TeX + PDF). One row per generation attempt per job.

**Created/altered by:**
- `migrations/005_tailored_resumes.sql` (base table)
- `migrations/012_regeneration_reason.sql` (adds `regeneration_reason`)

| Column | Type | Nullable | Default | Meaning |
|---|---|---:|---|---|
| `job_id` | `TEXT` | no | — | FK to jobs |
| `run_id` | `TEXT` | no | — | FK to jobs |
| `tex_path` | `TEXT` | yes | — | Repo-relative path to generated `.tex` file |
| `pdf_path` | `TEXT` | yes | — | Repo-relative path to compiled `.pdf` file |
| `meta_path` | `TEXT` | yes | — | Repo-relative path to `meta.json` |
| `word_count` | `INT` | yes | — | Resume word count |
| `model` | `TEXT` | yes | — | LLM model used |
| `prompt_sha` | `TEXT` | yes | — | SHA of prompt used |
| `canonical_sha` | `TEXT` | yes | — | SHA of canonical `resume_master.tex` at generation time |
| `input_tokens` | `INT` | yes | — | Input token count |
| `output_tokens` | `INT` | yes | — | Output token count |
| `compile_status` | `TEXT` | yes | — | `ok \| failed \| skipped` |
| `generated_by` | `TEXT` | yes | — | `pipeline \| manual \| cached` |
| `flags` | `JSONB` | no | `'[]'` | Array of flag strings |
| `generated_at` | `TIMESTAMPTZ` | no | `NOW()` | Generation timestamp |
| `regeneration_reason` | `TEXT` | yes | `NULL` | Why this row replaced a prior attempt (`null` = first generation). Values: `previous_resume_gen_failed`, `previous_cover_gen_failed`, `previous_both_failed`, `manual_force`, `explicit:<reason>` |

**Primary key:** `(job_id, run_id)`

**Written by:** `src/storage/persist.ts` → `insertTailoredResumeArtifact()`

---

## Table: `cover_letters`

**Purpose:** Metadata for generated cover letters (TeX + PDF + text content).

**Created/altered by:**
- `migrations/001_initial.sql` (base columns)
- `migrations/006_cover_letter_artifacts.sql` (tex/pdf/meta paths, prompt_sha, canonical_sha, tokens, compile_status, generated_by, flags)
- `migrations/012_regeneration_reason.sql` (adds `regeneration_reason`)

| Column | Type | Nullable | Default | Meaning |
|---|---|---:|---|---|
| `job_id` | `TEXT` | no | — | FK to jobs |
| `run_id` | `TEXT` | no | — | FK to jobs |
| `content` | `TEXT` | yes | — | Often NULL; pipeline writes letters to disk |
| `file_path` | `TEXT` | yes | — | Path to `.md` file (legacy) |
| `tex_path` | `TEXT` | yes | — | Repo-relative path to generated `.tex` file |
| `pdf_path` | `TEXT` | yes | — | Repo-relative path to compiled `.pdf` |
| `meta_path` | `TEXT` | yes | — | Repo-relative path to `meta.json` |
| `word_count` | `INT` | yes | — | Word count |
| `model` | `TEXT` | yes | — | LLM model used |
| `prompt_sha` | `TEXT` | yes | — | SHA of prompt version |
| `canonical_sha` | `TEXT` | yes | — | SHA of canonical resume TeX at generation time |
| `input_tokens` | `INT` | yes | — | Input token count |
| `output_tokens` | `INT` | yes | — | Output token count |
| `compile_status` | `TEXT` | yes | — | `ok \| failed \| skipped` |
| `generated_by` | `TEXT` | yes | — | `pipeline \| manual` |
| `flags` | `JSONB` | no | `'[]'` | Array of flag strings |
| `generated_at` | `TIMESTAMPTZ` | no | `NOW()` | Generation timestamp |
| `regeneration_reason` | `TEXT` | yes | `NULL` | Why this row replaced a prior attempt. Same values as `tailored_resumes.regeneration_reason` |

**Primary key:** `(job_id, run_id)`

**Written by:** `src/storage/persist.ts` → `insertCoverLetterArtifact()`

**Read by:** UI server reads `file_path` / `tex_path` and resolves content from disk.

---

## Table: `seen_jobs`

**Purpose:** Persistent backing store for exact dedup across runs (survives Redis flush).

**Created by:** `migrations/001_initial.sql`

| Column | Type | Nullable | Default | Meaning |
|---|---|---:|---|---|
| `source` | `TEXT` | no | — | Source name |
| `job_id` | `TEXT` | no | — | Job id |
| `first_seen` | `TIMESTAMPTZ` | no | `NOW()` | First seen time |

**Primary key:** `(source, job_id)`

**Indexes:** `seen_jobs_source_idx`, `seen_jobs_first_seen_idx`

**Written by:** pipeline persistence `saveJob()` always inserts `seen_jobs` row.

---

## Table: `labels`

**Purpose:** Human labeling and application tracking used for calibration and UI workflow.

**Created/altered by:**
- `migrations/003_labels.sql` (base table)
- `migrations/004_ui_application_tracking.sql` (application tracking columns + constraint + index)

| Column | Type | Nullable | Default | Meaning |
|---|---|---:|---|---|
| `job_id` | `TEXT` | no | — | FK to jobs |
| `run_id` | `TEXT` | no | — | FK to jobs |
| `label` | `TEXT` | no | — | `yes \| maybe \| no` |
| `notes` | `TEXT` | yes | — | Freeform user notes |
| `labeled_at` | `TIMESTAMPTZ` | no | `NOW()` | Label timestamp |
| `application_status` | `TEXT` | yes | — | `applied \| skipped \| apply_later` |
| `applied_at` | `TIMESTAMPTZ` | yes | — | Set when `application_status='applied'` |

**Primary key:** `(job_id, run_id)`

**Indexes:**

- `labels_label_idx` on `(label)`
- `labels_application_status_idx` on `(application_status)`

**Written by:**

- UI server: `POST /api/label` upsert sets label, notes, application_status, applied_at
- CLI: `src/storage/label-cli.ts` inserts label + notes only (no application_status)

**Example row:**

```json
{
  "job_id": "dice-12345678",
  "run_id": "manual-...",
  "label": "yes",
  "notes": "Great Java/Spring role; apply via company site.",
  "labeled_at": "2026-04-29T20:30:00.000Z",
  "application_status": "apply_later",
  "applied_at": null
}
```

