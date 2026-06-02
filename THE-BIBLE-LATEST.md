# THE BIBLE — v13 (2026-06-02)

> Project: **job-hunter** — automated job discovery + filter + score + judge + cover letter pipeline for Sarath Konuru.
>
> This is the authoritative document. Supersedes v12 (2026-05-27), v11 (2026-05-27), v10 (2026-05-27), v9 (2026-05-26), v8 (2026-05-14), v7 (2026-04-29), v6 (2026-04-25), v5 (2026-04-25), v4 (2026-04-23), v3 (2026-04-20), v2 (2026-04-18), and v1 (2026-04-17).
>
> Read this before writing code. Update this file when module status changes.
>
> Bible file policy: keep only two Bible files in the repo. `THE-BIBLE-v1.md`
> is the original architecture snapshot. `THE-BIBLE-LATEST.md` is the single
> rolling source of truth. Do not create per-version Bible archives.

---

## What changed since v12

v13 is a quality, correctness, and reliability update. Twenty issues were identified through a
corpus-level audit of 84 production meta.json files, log analysis across all pipeline runs, and
deep code inspection. All changes ship together; a full batch run is required to measure the
"after" metrics.

**Wave 1 — Judge prompt: richer `frame_as`, banned phrases, fit test (Issues 3, 4, 6)**
`src/judge/prompt.ts` received three coordinated changes. The `frame_as` field definition was
expanded from "a 1-sentence concrete framing" to a 2–3 sentence structured brief specifying
(1) role context at `target_role`, (2) adjacent evidence from canonical bullets, and (3) the
execution angle. One-sentence compression was the root cause of both hedge-poisoned `frame_as`
strings (17 confirmed in 84-job corpus) and the judge's excessive conservatism on `fabricate`
directives (only 5 fabricates vs 70 acknowledges across 84 jobs). The `frame_as` guidance now
includes the full banned phrase family so the judge cannot emit hedging language there. The
output format example was updated to show a multi-sentence brief (LLMs anchor on examples).
The `fabricate` plausibility test was rewritten from a detectability test ("would a cold HM
notice?") to a fit test ("do the canonical bullets at `target_role` provide enough contextual
fit?"). The old test was instructing the judge to protect against getting caught, not to maximise
resume quality.

**Wave 2 — Generator voice and positioning (Issue 2)**
`src/resume-generator/prompt.ts` gained a `VOICE AND POSITIONING` section before the existing
`BULLET QUALITY GATE`. The section requires confident, achievement-oriented bullets, strong
action verbs, and result endings. The SKILL.md manual mode has always had this instruction;
the pipeline prompt was missing it entirely. Prompt also gained an explicit prohibition on
nested `\textbf{}` inside another `\textbf{}` (compile fix, see Wave 5).

**Wave 3 — Swap-aware SKILLS atomicity and scoped cover-letter experience block (Issues 1, 8, 9)**
`src/shared/utils.ts` (new file) adds `escapeRegexStr`, `applyTechSwaps`, and
`applyScopedTechSwaps`. The last function applies each swap only within the employer section
matching `target_role`; unscoped swaps apply globally. `replaceSkillsSection` in
`src/resume-generator/index.ts` now accepts `techSwaps` and applies them deterministically to
canonical SKILLS before restoring the section — preserving hallucination protection while
allowing approved judge swaps to survive. The call site passes `input.tech_swaps`. The
`skillsSectionEqual` helper in `scripts/audit-artifacts.ts` was updated to apply swaps to
canonical before comparing (and uses `normalizeBlock` not raw `.trim()`), so correctly swapped
SKILLS sections no longer trigger false "SKILLS polluted" flags. `coverLetterInputFromBundle`
in `src/shared/artifact-bundle.ts` now calls `applyScopedTechSwaps` on the experience block
before passing it to the cover letter generator, ensuring the cover letter LLM receives
post-swap tech names rather than requiring it to reconcile two contradictory inputs.

**Wave 4 — Jaccard attribution detection replaces 5-word run matching (Issue 7)**
`src/risk-map/audit.ts::hasOverlap` was replaced with stop-word-filtered Jaccard content-word
matching at threshold 0.45. The old 5-word consecutive run heuristic required near-verbatim
bullet preservation that LLMs never produce (they paraphrase by design). Result: 30/84 jobs
(36%) were flagged `resume_attribution_overrun` — almost certainly over-counted. The Jaccard
approach checks whether a generated bullet shares ≥45% of unique content words with any
canonical bullet at the same role. The overrun threshold (`fab > 3`) is intentionally unchanged
pending a clean batch run to set it based on real detection data.

**Wave 5 — PDF compile failures fixed (Issue 11)**
`boldMetrics` in `src/resume-generator/index.ts` regex changed from `[^{}]*` to
`(?:[^{}]|\{[^{}]*\})*`, fixing Class A failures where the LLM emitted nested
`\textbf{\textbf{DB}}` causing orphaned braces. `src/resume-generator/saver.ts` now deletes any
stale `resume.pdf` before compile so a PDF produced by the current pdflatex run counts as
success even when pdflatex exits nonzero (nonstopmode Class B: unbalanced `\end{itemize}` writes
a valid PDF but exits nonzero).

**Wave 6 — Style lint expansion (Issue 10)**
`src/shared/style-lint.ts` gained three patterns with zero false-positive risk:
`aligning with your need for`, `as required by the role`, `gained hands-on exposure`. These
appear in no legitimate professional writing and should be caught at the runtime gate, not only
at the prompt level.

**Wave 7 — Resilient generation: transient API errors and stream abort retry (Issues 15, 16)**
`src/cover-letter/generator.ts` gained a separate transient-error retry counter. Empty content,
terminated streams, and OpenRouter 5xx errors now use `apiErrorCount` (cap: 2, backoff: 3s/6s)
and do not consume content-quality retry attempts. This fixes the confirmed pattern where
`cyber-1-armor` failed on two consecutive attempts with `OpenRouter returned empty content`
then succeeded on the third. `src/resume-generator/generator.ts` gained a single silent 5s
retry for premium model stream aborts (`TypeError: terminated`) before falling back to Flash —
targeting the pattern where OpenRouter slowness killed a stream at the 300s timeout.

**Wave 8 — Risk map: correctness, coverage, and noise reduction (Issues 5, 13, 14, 19, 20)**
Four coordinated changes to `config/tech-equivalence-risk-map.json`:
(a) 13 Phase-8 entries were originally mutated from `adjacent` to `direct_equivalent`; the fix
restores parallel `adjacent` + `direct_equivalent` entries so both indexes carry both
relationship types and `lookupJdSkill` returns the best by lowest distance. (b) 28 new
`direct_equivalent` entries added for terms appearing in 2025–2026 Java backend JDs: RDS, Aurora,
ECS, ECR, CloudFront, Azure SQL, ACR, Azure Container Registry, AAD, Azure Active Directory, Key
Vault, Pub/Sub, Cloud Run, GitLab CI, CircleCI, ArgoCD, Grafana, OpenTelemetry, Hibernate (short
name), MariaDB, SNS, Postman, gRPC, OWASP, Jira, Confluence, Terraform, SNS. All entries carry
`safe_language`, `disallowed_claims`, and `interview_defense`. (c) `requires_human_review` set to
`false` on 148 `jd_target_index` entries (139 in `resume_source_index`) that are pure naming
variants, full product names, or obvious synonyms generating pure badge noise. 35 entries kept
`true` for concept-to-tool mappings where interview depth questions are plausible (EKS, Memcached,
Jest, Flowable, Activiti, ETL scripting/Python, etc.). (d) New migration
`migrations/011_ledger_truth_distance_numeric.sql` changes `fabrication_ledger.truth_distance_score`
from `INTEGER` to `NUMERIC`, required because fractional Phase-8 scores (0.05–0.2) caused insert
errors on the existing integer column.

**Validation for v13.**
`npm run build` passed. `npm test` passed: 24 test files passed, 1 skipped; 297 tests passed,
8 skipped. `npm run audit:artifacts` passed with `skills_pollution: 0`. Small batch
(`EXTRACT=1 SOURCE=jobright_api MAX=5`) completed. Single-job run after migration 011 confirmed
fractional ledger inserts succeed. Full batch metrics pending — "after" column in the metrics
table requires a fresh ≥20-job run.

---

## What changed since v11

v12 is a repo-operations and path-clarity update on top of the v11 recovery
and premium-generation work.

**Wave 1 — Application output is date-grouped, not only run-grouped.**
`src/applications/run-folder.ts` now builds artifact folders as
`output/applications/{YYYY-MM-DD}/{run_label}/{slug}/...` for pipeline runs and
`output/applications/{YYYY-MM-DD}/manual_{ISO timestamp}/{slug}/...` for manual
generation. This keeps the per-run identity from v8 while making same-day
artifact review and archiving much easier.

**Wave 2 — Run logs are date-grouped across every entry path.**
Direct `scripts/run-pipeline.ts` runs, orchestrator-managed child runs, and
manual UI/API artifact generation logs now all land under
`output/logs/runs/{YYYY-MM-DD}/...`. Filenames still include timestamp,
run-folder identity, source, and short run id or job id, so the new day folder
adds browseability without losing traceability.

**Wave 3 — Prompt/runtime cleanup landed with the layout refresh.**
`src/resume-generator/prompt.ts` now documents the total-mode prompt as the
single path, replacing the old SKILL.md runtime chain. `src/cover-letter/prompt.ts`
is now explicitly `PROMPT_VERSION="pipeline-tex-v3"` with the canonical fact
guard centered around the same swap/fabrication data the resume generator uses.
`src/shared/style-lint.ts` also widened the banned bridge-language family to
catch phrases such as "parallel to", "syntactically equivalent to",
"transitional knowledge of", and "transferable skills".

**Wave 4 — Local context docs are intentionally untracked.**
`.gitignore` now ignores `HANDOFF.md`, `HANDOFF-*.md`, `CHAT-CONTEXT*.md`, and
`SESSION-NOTES*.md`, clarifying that chat-to-chat transfer notes are local
operator context rather than repository history.

**Validation for v12.**
No code-path changes were made after the latest green state; this update
reconciles the Bible with commits `4df9f39`, `41add01`, and `e40aaac`.

---

## What changed since v10

v11 is an operational visibility and manual-recovery update on top of the v10
quality guards.

**Wave 1 — Failed artifact metadata is no longer hidden.**
`src/applications/combined-meta.ts` now preserves failure details for missing
artifacts in the combined `meta.json`. Resume failures keep `resume.error`
from the generator outcome. Cover-letter failures keep real `model`,
`prompt_sha`, token counts, `word_count`, `compile_status`, `flags`, and
`cover_letter.error` instead of flattening to a misleading `"skipped"` block.
`src/cover-letter/saver.ts` now stores `clResult.error` in cover metadata, so
`cover_letter_gen_failed` has a useful diagnosis when the model fails or the
truncation guard rejects the final attempt.

**Wave 2 — Manual and direct-run logs are captured.**
Direct `scripts/run-pipeline.ts` invocations now tee stdout/stderr to
`output/logs/runs/{YYYY-MM-DD}/log_{timestamp}_{run-folder}_{source}_{runid}.log`, matching the
operational habit established by the orchestrator. Set
`PIPELINE_DISABLE_RUN_LOG=1` only when intentionally suppressing this local
diagnostic file. Manual UI/API artifact generation now writes a compact
`output/logs/runs/{YYYY-MM-DD}/manual_{timestamp}_{run-folder}_{jobid}.log` with job id, force mode,
output folder, models, flags, and generator errors.

**Wave 3 — Failed manual artifacts can be regenerated from the UI/API.**
`src/storage/persist.ts::jobHasCompleteArtifacts()` checks the latest resume row
and latest cover row and returns true only when both have usable paths and are
not failed. `src/artifacts/manual-generate.ts` now conflicts only when
`force=false` and complete artifacts already exist. This lets the UI Generate
button repair jobs where resume or cover generation failed. The `JobCard`
component passes `force=true` only when the card already has a resume or cover
PDF and the user is intentionally regenerating.

**Wave 4 — Resume generation is more tolerant of DeepSeek Pro wrapping.**
`src/resume-generator/generator.ts` now extracts the LaTeX document from the
first `\documentclass` through the last `\end{document}` before strict
validation. This targets the observed DeepSeek v4 Pro failure mode where the
model appears to return valid LaTeX wrapped in extra prose or markdown. If a
resume still fails, the stored error now includes useful first/last-character
snippets or the exact banned style pattern family that caused rejection.

**Wave 5 — Premium resume path and stricter artifact quality guards.**
Resume generation now supports a premium first-call route: if the judge verdict
is STRONG and score is at least `resume_generator.premium_min_score`, the resume
generator tries `resume_generator.premium_model` with OpenRouter streaming. If
the premium stream errors, drops, times out, or fails validation, it logs the
reason and falls back to the normal Flash model for that job. No Flash-first
redo loop is used. Quality guards also tightened: resume prompt now enforces a
summary relevance gate, CAR-style bullet quality gate, and project placement /
scope rule; cover-letter prompt now has a canonical fact guard; resume
post-processing bolds numeric outcomes and scale markers inside `\item` lines.

**Validation for v11.**
`npx tsc --noEmit` passed. `npx vitest run` passed with 20 files, 279 tests, and
8 skipped. `test/applications/combined-meta.test.ts` covers the failed resume
and failed cover metadata contract; resume and cover prompt tests cover the new
quality gates.

---

## What changed since v9

Ten waves of Round-2 quality work landed between v9 and v10.

**Wave 1 — Canonical resume intake refreshed.**
`config/resume_master.tex` was replaced from the uploaded
`/Users/skonuru/Downloads/resume_fin.tex` after compatibility checks. The new
canonical keeps all 12 SUMMARY bullets, has valid `SUMMARY`, `SKILLS`,
`EXPERIENCE`, `PROJECTS`, `EDUCATION`, and `AWARDS` sections, and is cleaned of
LaTeX/Unicode em/en dash forms while preserving ordinary single hyphens. The
role extractor was widened to tolerate `\vspace{}` between an employer/date line
and the following `\textit{Role}` line, so the new Hitachi block is parsed
without reshaping the canonical resume to fit an old regex.

**Wave 2 — Profile and skills reconciliation.**
`config/profile.json` and `config/skills.json` were reconciled to the visible
canonical SKILLS section. Aliases now normalize visible variants such as
`Javascript` to `JavaScript`, `Typescript` to `TypeScript`, `Golang` to `Go`,
`ReactJS` to `React`, `Fast API` to `FastAPI`, and `Apache Kafka` to `Kafka`.
The profile now carries 84 visible canonical skills; the alias registry has 93
canonical entries and 408 aliases.

**Wave 3 — Dash-free generation hardening.**
`src/shared/dash-lint.ts` adds `stripDashes()`, which rewrites `--`, `---`,
U+2013, and U+2014 into safe prose forms while preserving single hyphens.
`src/resume-generator/index.ts` applies it before resume save/compile, and
`src/cover-letter/generator.ts` applies it to the generated body before LaTeX
assembly. Resume and cover-letter prompts now explicitly ban em/en dash output.

**Wave 4 — Resume style guard plus enforceable style lint.**
`src/resume-generator/prompt.ts` now contains a non-negotiable bullet style
guard: no bridging phrases, no two-stack hedge sentences, no JD-targeting tails,
no gap confessions, and no invented metrics. `src/shared/style-lint.ts` makes
the high-risk phrase family enforceable. Resume generation rejects and retries
outputs containing banned bridge language instead of relying on the prompt
alone.

**Wave 5 — SKILLS section atomicity is now hard, not only prompted.**
The resume prompt still says the SKILLS section is locked to canonical content,
but `src/resume-generator/index.ts::replaceSkillsSection()` now replaces the
generated SKILLS block with the canonical SKILLS block before save/compile. This
prevents model-added Cypress/Playwright/Cucumber-style pollution and also
prevents harmless-looking reorder/rewrite drift from creating future false
claims.

**Wave 6 — Cover-letter consistency with tailored resume claims.**
`src/cover-letter/prompt.ts` no longer hardcodes employer stacks. It now renders
`ACTIVE_TECH_SWAPS` and `FABRICATED CLAIMS THE RESUME HAS MADE` from the same
judge JSON consumed by the resume generator. The cover letter must narrate the
post-swap story that the paired tailored resume presents, without switching
employers inside a paragraph.

**Wave 7 — Cover-letter truncation handling.**
`config/config.json` raises cover-letter `max_tokens` to 3000 and restores one
retry. `src/cover-letter/generator.ts::looksTruncated()` detects bodies that do
not end in sentence punctuation. If the retry still looks truncated or still
contains banned bridge language, generation fails cleanly with
`cover_letter_gen_failed` instead of writing a risky partial cover letter.

**Wave 8 — Extractor preferred-section recall.**
Extractor model config is now `deepseek/deepseek-v4-flash`. New
`src/extractor/segment.ts` splits JDs into `tags_chips`, `required`,
`preferred`, `responsibilities`, and `other`. `buildUserPromptWithSegments()`
feeds those labeled blocks into the extractor prompt with explicit importance
hints so Preferred-section technologies are not dropped behind abstract
Required-section prose.

**Wave 9 — Judge hardening.**
Judge strict-schema mode remains in place, and
`src/judge/schema.ts` now mirrors nested `tailoring_hints.gap_directives` shape
instead of allowing arbitrary objects. `src/judge/judge.ts` captures final
failed validation payloads to `output/logs/judge_failures/{run_id}_{job_id}.json`
after the retry, so future schema fixes are driven by real payloads. The judge
prompt now treats impossible prior-employer restrictions and active credential
requirements as WEAK blockers, and the fabricate guide now requires choosing
the most plausible target role rather than defaulting to the newest role.

**Wave 10 — Artifact quality audit and overrun soft gate.**
`scripts/audit-artifacts.ts` audits the four requested historical run folders
without mutating them and writes
`output/audits/round2_artifact_quality_baseline.{json,md}`. Baseline findings:
53 resumes, 49 cover letters, 48 partial improvements over original, 5 no clear
improvements, 17 style-issue jobs, 42 dash-issue jobs, 3 truncated covers, 51
SKILLS-drift jobs, 1 employer-stack mismatch, and 38 attribution overruns.
`src/risk-map/audit.ts::applyResumeAttributionOverrunFlag()` now adds
`resume_attribution_overrun` when fabricated role attribution exceeds 3.

**Validation for v10.**
`npx tsc --noEmit` passed. `npx vitest run` passed with 20 files, 274 tests, and
8 skipped. A live `SOURCE=jobright_api MAX=10 EXTRACT=true DO_RESUME=true
DO_COVER=true` run loaded the new config, extracted 7/7 eligible jobs, produced
5 resume/cover pairs, had `judge_failed=0`, `cover_letter_gen_failed=0`, and
`cover_letter_length_off=0`. That live run exposed one remaining bridge phrase
and SKILLS drift, which led directly to the enforced style lint and hard SKILLS
replacement above.

---

## What changed since v8

Ten waves of work landed between v8 and v9.

**Wave 1 — Bug 1 (session 3, locked decision): cover_letters FK ordering fixed.**
`scripts/run-pipeline.ts` stage 16 now inserts artifact rows only after `saveJob`
has created the parent `jobs` row. This preserves the intended "mid-run crash →
retry" semantics while removing the FK-ordering failure that could strand a run
half-persisted.

**Wave 2 — Resume generator simplification.**
`src/resume-generator/index.ts` no longer retries generation solely because the
word count is below 1900. The generator still emits the `resume_too_short` flag
for visibility. The TECH SWAPS prompt block was also trimmed and clarified.

**Wave 3 — Canonical resume header fix (Bug A).**
`config/resume_master.tex` no longer contains the placeholder
`mailto:your@email.com`; the canonical resume now carries the real address.

**Wave 4 — Cover letter LaTeX location-line fix (Bug B).**
`formatProfileLocationLine` in `src/shared/artifact-bundle.ts` no longer feeds
`\quad` through `escapeLatexPlain`, eliminating the literalized spacing bug in
cover letter headers.

**Wave 5 — Cover letter role-attribution fabrication fix (Bug E).**
`src/cover-letter/resume-brief.ts` now uses
`buildExperienceBlockFromCanonicalTex()` to slice the EXPERIENCE section
verbatim from `config/resume_master.tex`. The old flattened
`summary_metrics[]` / `recent_roles[]` / `flagship_projects[]` path is gone.
`src/cover-letter/prompt.ts` now carries a non-negotiable employer-attribution
rules block plus a paragraph-scope employer rule. Related wiring touched
`src/cover-letter/types.ts`, `src/shared/artifact-bundle.ts`,
`scripts/run-pipeline.ts`, and `src/artifacts/manual-generate.ts`.

**Wave 6 — Audit role-attribution blind-spot fix (Bug F).**
`src/risk-map/audit.ts` now includes `auditRoleAttribution()`, which diffs
generated `\item` strings against canonical bullets per role and flags tech in
new unmatched bullets. Bold-text token extraction was added as a fallback when
registry matching misses. New ledger row type:
`fabricated_role_attribution`. New counter:
`risk_summary.counts.fabricated_role_attribution`. The
`fabrication_ledger` table schema did not change.

**Wave 7 — Migration cleanup.**
`migrations/005_tailored_artifacts.sql` was cleaned up so it creates only
`tailored_resumes` plus its two indexes. The old `cover_letters` block was
removed because `006_consolidate_artifacts.sql` supersedes it, and the transient
`version` column plus `UNIQUE(job_id, version)` were removed because 006 drops
them immediately. Replay safety against the current 006-shaped DB is preserved.

**Wave 8 — Orchestrator log filenames.**
`src/orchestrator/monitor.ts` and `src/orchestrator/runner.ts` now write
timestamped, source-labeled filenames such as
`log_2026-05-26T02-45-00_linkedin_12345678.log`.

**Wave 9 — Repo hygiene.**
The caveman skill files were removed from git tracking and added to `.gitignore`.

**Wave 10 — Judge v5 additive planner.**
Judge output now supports employer-scoped fabrication planning without adding
new modules, new tables, or new LLM calls. v5 adds optional
`gap_directives[]` plus optional `target_role` on
`tailoring_hints.tech_swaps[]`. Resume and cover-letter generators consume these
fields additively and fall back to v4 behavior when they are absent.

---

## What changed since v7

Two waves of work landed between v7 and v8.

**Wave 1 — Run-folder output layout (pipeline phase 3 / v4 quality fixes).**
Output artifact path changed from flat `output/applications/{slug}/` to nested
`output/applications/{run_label}/{slug}/...` where `run_label` is
`{ISO timestamp}_{run_id first 8}` for pipeline runs and
`manual_{ISO timestamp}` for manual regenerates. DB columns `tex_path`/`pdf_path`
now store the full relative path including run folder. Existing flat-layout
folders stay where they are; new generations land in run folders. See §18.1.

**Wave 2 — Tech equivalence risk map + fabrication ledger (pipeline phase 4 / v5 simplified).**
Added `config/tech-equivalence-risk-map.json` (560 mappings, 6-level relationship
taxonomy: exact / reworded / direct_equivalent / adjacent / unsupported_inference /
fabricated). Pipeline now: (a) enriches every JD required_skill with a risk_entry
before the judge runs, (b) judge prompt bumped to v4 with risk-aware behavior and
emits `tailoring_hints.tech_swaps`, (c) resume + cover letter generators apply
tech_swaps as Mode B substitution, (d) post-generation audit grades every claim
against the risk map and writes one row per claim to a new `fabrication_ledger`
table, (e) `meta.json` per artifact has `risk_summary` + `export_status`, (f) UI
shows green/yellow badges per artifact, click-yellow expands review items.
Policy modes (strict / research / chaos_measurement) were specced and dropped
before implementation. Total mode behavior in resume generator preserved end-to-end.
See §18.2.

---

## 1. What changed since v6

**Milestone 9 — Review UI built and shipped (2026-04-29).**

One wave of work landed between v6 and v7: the local web review UI (`localhost:3001`) that serves as both a workflow tool (browse → apply → track) and a calibration tool (label every job yes/maybe/no across all buckets including hard rejections and archive).

**Migration 004** (`migrations/004_ui_application_tracking.sql`) adds two columns to `labels`: `application_status TEXT CHECK IN ('applied','skipped','apply_later')` and `applied_at TIMESTAMPTZ`, plus a supporting index. Idempotent; safe to re-run.

**Express server** (`scripts/ui-server.ts`) runs on **port 3001** (the default port is occupied on the dev machine). Runs migration 004 on startup, serves the Vite production build from `ui/dist/`, and exposes five API endpoints: `GET /api/apply-queue`, `GET /api/rejections-hard`, `GET /api/rejections-soft`, `GET /api/stats`, `POST /api/label`.

**Frontend** (`ui/`) is a Vite + React + TypeScript SPA. Three tabs: Apply Queue, Hard Rejections, Soft Rejections. Dark theme, no external CSS framework, no state library, no router.

**Key implementation notes discovered during build:**
- `cover_letters.content` is always NULL in the DB — the pipeline writes cover letters to disk only. The server reads the file via `cover_letters.file_path`, with a path-substitution fallback for the historical `/Downloads/project/` → `/Downloads/jobs/` rename.
- Express 5 ships with `path-to-regexp` v8 which rejects bare `*` wildcards; SPA fallback must use `app.use(...)` not `app.get('*', ...)`.

**UI Delta 2 changes (same session):** four incremental improvements applied on top of the base build:
1. "Not Applied" replaces "Skipped" everywhere in the UI (DB value stays `skipped`).
2. Quick-fill note chips appear on any labeled card — clicking a chip when label=No (apply mode) fills the textarea and immediately POSTs + moves the card to Not Applied; for Yes/Maybe it fills the textarea only.
3. `apply_later` added as a valid `application_status` value. Three secondary action buttons in Apply Queue: Applied / Apply Later / Not Applied. Apply Later cards get a purple badge and stay visible in the Pending filter. Stats header gains an "Apply Later: N" count.
4. Relative time shown alongside absolute date on every card (`Apr 23, 2026 · 3h ago`).

**Apply Queue sort order** (time-decayed score): jobs bucketed by age (< 24h → 24–72h → > 72h), sorted by `score DESC` within each bucket. Newest high-scoring jobs appear first.

---

## What changed since v5

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
├── ui/                    ← Vite + React + TS review UI (NEW in v7)
│   ├── src/
│   │   ├── api.ts         ← typed fetch wrappers
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── styles.css
│   │   ├── components/    ← Tabs.tsx, JobCard.tsx
│   │   └── tabs/          ← ApplyQueue.tsx, HardRejections.tsx, SoftRejections.tsx
│   ├── dist/              ← gitignored — production build served by ui-server
│   └── package.json       ← separate npm workspace (cd ui && npm install)
├── scraper/               ← Python: dice.py, jobright.py, jobspy_adapter.py + common/
├── scripts/               ← CLI scripts (run-pipeline.ts, ui-server.ts, sort-log.ts, etc.)
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
| 10 | LLM extract → structured fields (Zod-validated, citation-verified). v10 segments JD text into tags/chips, required, preferred, responsibilities, and other before prompting | `EXTRACT=0` |
| 11 | Skill normalization through alias map | — |
| 12 | Score (5 components: skills 0.35, semantic 0.25, yoe 0.15, seniority 0.15, location 0.10) | scoring disabled |
| 12.5 | **Cross-site semantic dedup (pgvector)** — only on GATE_PASS jobs with embedding | `SKIP_DEDUP=1` or DB down |
| 13 | Threshold gate: score ≥ 0.50 → GATE_PASS, else ARCHIVE | scoring disabled |
| 14 | LLM judge — STRONG / MAYBE / WEAK + reasoning + concerns + optional v5 `gap_directives[]` + scoped `tailoring_hints.tech_swaps[]`; final validation failures are captured under `output/logs/judge_failures/` | judge disabled |
| 15 | Bucket routing: STRONG+score≥0.70→COVER_LETTER, STRONG+score<0.70→RESULTS, MAYBE→REVIEW_QUEUE, WEAK→ARCHIVE | — |
| 16 | Artifact generation (resume + cover letter) for COVER_LETTER jobs and eligible REVIEW_QUEUE jobs → write `.tex`/`.pdf`/`meta.json` under `output/applications/{YYYY-MM-DD}/{run_label}/{slug}/`; resume output is dash-cleaned, style-linted, and canonical-SKILLS-locked before save | artifact flags disabled or bucket below threshold |
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

**`004_ui_application_tracking.sql`** — new in v7. Pure additive. Idempotent.

- `labels.application_status TEXT CHECK IN ('applied','skipped','apply_later')` — tracks what action was taken from the review UI. NULL for rows written by `label-cli.ts` (calibration-only labels, no application action).
- `labels.applied_at TIMESTAMPTZ` — set to `NOW()` when `application_status = 'applied'`; NULL otherwise.
- `CREATE INDEX labels_application_status_idx ON labels(application_status)`.
- The constraint is dropped and re-created idempotently on each server startup so it can be safely extended (as was done when `apply_later` was added after the initial schema was live).

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
- `output/logs/runs/{YYYY-MM-DD}/log_{timestamp}_{run-folder}_{source}_{runid}.log` — per-run stdout+stderr captured verbatim. Orchestrator child runs and direct `scripts/run-pipeline.ts` invocations both create source-labeled logs. `tail -f` to watch a live run.
- `output/logs/runs/{YYYY-MM-DD}/manual_{timestamp}_{run-folder}_{jobid}.log` — compact log for manual UI/API artifact generation attempts.
- `output/logs/judge_failures/{run_id}_{job_id}.json` — final failed judge payload plus schema error after validation retry.
- `output/audits/round2_artifact_quality_baseline.{json,md}` — historical artifact-quality audit outputs.

### TypeScript types

`src/storage/types.ts` defines `RunRecord`, `RunStats`, `JobRecord`. `RunStats` gains two new fields since v5: `extractions_attempted` and `extractions_succeeded`. The type change is intentionally compile-breaking on callers that don't pass the new fields, forcing the one call site (`run-pipeline.ts`) to be updated.

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
| Extractor | ✅ Green (strict schema + segmentation) | validation + segmentation coverage |
| Scorer (5 components + bge embeddings) | ✅ Green | 44 tests |
| LLM judge | ✅ Green (v5 additive planner + v10 hard blockers) | schema + prompt coverage |
| Resume generator | ✅ Green (v5 consumer + v13 voice/swap/compile guards) | prompt, gap-directive, SKILLS atomicity, swap-aware coverage |
| Cover letter generator | ✅ Green (v5 consumer + v13 transient retry + swap experience block) | prompt, truncation, style/directive, transient retry coverage |
| Risk map / audit | ✅ Green (Jaccard detection + expanded map) | fabrication ledger, overrun flag, Jaccard overlap, scoped swap coverage |
| Shared utils | ✅ Green (new: applyTechSwaps, applyScopedTechSwaps) | scoped/unscoped swap tests |
| Dedup module (Redis + pgvector) | ✅ Green | 7 tests |
| Storage (Postgres + pgvector) | ✅ Green | 14 tests |
| Storage v4.1 hardening | ✅ Applied | saveJob crash fixed, formatErr, markStorageDisabled |
| Storage v5.1 (orchestrator columns) | ✅ Applied | 002_orchestrator.sql, RunStats updated, persist.ts updated |
| POSTED_WITHIN recency filter | ✅ Wired | env var → cli.py → dice.py |
| Optional integrity check | ✅ Built | `src/storage/integrity.ts`, gated on `VERIFY=1` |
| **Orchestrator** | ✅ **Built** | **16 tests — lock (8) + runner (5) + reaper (3)** |
| Sarath's profile | ✅ Validated | min comp $110k confirmed |
| Docker Compose (Postgres + Redis) | ✅ Built | `docker compose up -d` |
| **Review UI (M9)** | ✅ **Built** | **Express API + Vite/React SPA, port 3001** |

**Test totals: 297 tests green, 8 skipped** across 24 passing test files. New test files cover shared utils (scoped swap), cover letter transient retry, skills-atomicity swap path, and gap-directive rendering updates. UI has no automated tests (manual verification only per spec).

### Designed but not built

| Component | Design status | Notes |
|---|---|---|
| Scoring calibration on real data | In progress | UI now built — labeling can begin |
| Notification UI | Out of scope | Defer until 2+ weeks unattended |

### Not built, not designed

- Profile-builder (resume → profile.json) — `profile.json` maintained by hand; low priority for single-user
- Real-data extraction fixture expansion — mechanism is wired (`SAVE_FIXTURES=1`), but the main extractor safety work now comes from strict schema mode plus v10 segmentation.

---

## 8. Module breakdown

### `config/` — BUILT

- `resume_master.tex` — canonical resume. v10 refreshed from `resume_fin.tex`; parser-compatible after the role extractor learned optional `\vspace{}` between employer headers and role lines.
- `profile.json` — Sarath's structured profile (v2). 84 visible canonical skills, 7 target titles. **Authoritative.** Min comp confirmed at $110k.
- `skills.json` — 93 canonical skill entries, 408 aliases. `buildAliasMap()` flattens to lookup map.
- `config.json` — locked models (`deepseek/deepseek-v4-flash` for extractor, judge, cover letter, and resume generator primary), optional resume fallback Flash alias, and optional premium resume route (`premium_model=deepseek/deepseek-v4-pro`, `premium_min_score=0.70`, `premium_stream=true`). Pro is not the normal fallback; it is tried first only for high-value STRONG jobs, with streaming, then Flash handles any premium failure. Also owns throttle_ms=100 (extractor + judge), scoring weights (0.35/0.25/0.15/0.15/0.10), gate threshold 0.50 (`scoring.gate_threshold`), cover-letter `max_tokens=3000`, cover-letter `retries=1`. Note: `config.json` also contains a `pipeline.schedule` block (`pipeline.sources`, etc.) — this is **legacy/unused**; the actual cron schedules are hardcoded in `src/orchestrator/scheduler.ts`, which is the single source of truth for when and how the pipeline runs.
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

Single file `src/fetcher/fetch.ts`. `fetchJobPage` is non-throwing, uses per-domain 2s polite delay, robots.txt cache, 15s timeout. `extractText` strips script/style/nav/header/footer.

### `extractor/` — BUILT

OpenRouter client (no SDK dependency, raw fetch).

- `src/extractor/client.ts` — OpenRouter API call. Currently uses strict `json_schema` response_format (with a JSON Schema mirror of the Zod schema), with fallback to `json_object` via `EXTRACTOR_FORCE_JSON_OBJECT=1` for models that reject strict mode.
- `src/judge/client.ts` — OpenRouter API call for judge stage. Uses strict `json_schema` response_format, with fallback to `json_object` via `JUDGE_FORCE_JSON_OBJECT=1`.
- `src/extractor/segment.ts` — v10 JD pre-pass. Splits text into `tags_chips`, `required`, `preferred`, `responsibilities`, and `other` so preferred-section technologies and tag-chip tech lists are not hidden behind abstract required prose.
- `src/extractor/prompt.ts` — `PROMPT_VERSION = "v1"`. Extract-don't-infer. Exact substring quotes 5–15 words. `buildUserPromptWithSegments()` feeds labeled segments with importance hints: tags/chips and required default to required, preferred defaults to preferred, responsibilities/other infer from context.
- `src/extractor/validate.ts` — Zod schema. Strips markdown fences if model ignored JSON mode.
- `src/extractor/extract.ts` — Never throws. Retries once on Zod failure (1s backoff). `verifyCitations` nulls bad quotes; partial extraction kept rather than rejected. `_callWithRetry` handles HTTP-level errors. `DEBUG_EXTRACT=1` env var triggers raw-response preview on validation failure.
- 3 synthetic fixtures (`jd-001`, `jd-002`, `jd-003`) plus 1 real-data fixture (`jd-real-002-java-full-stack-developer`). Pipeline supports `SAVE_FIXTURES=1` to capture more.

### `scorer/` — BUILT

5 pure scoring functions in `src/scorer/components.ts`, weighted-summed in `src/scorer/score.ts`. `src/scorer/embed.ts` lazy-loads `bge-small-en-v1.5` (q8) via `@huggingface/transformers`. LRU cache 500 entries by SHA256. Returns `Float32Array(384)`. Zero vector on failure.

Real-data validation confirmed (2026-04-25): scores 0.777–0.790 across 4 Dice jobs. Components behave as designed — `seniority=1.00` and `location=1.00` for senior roles in Sarath's market, `semantic=0.57–0.66` reflecting embedding quality.

### `judge/` — BUILT (v5)

LLM judge stage. Inputs: structured job fields + score breakdown (NOT raw JD text). Output is still additive JSON with `{verdict, reasoning, concerns[]}` at the core, plus optional v4/v5 context fields. v5 adds:

- top-level optional `gap_directives[]`
- optional `target_role` on each `tailoring_hints.tech_swaps[]`

`gap_directives[]` entries are:

- `jd_requirement`
- `handling`: `fabricate | reframe | acknowledge | ignore | forbid`
- `target_role`: exact employer header from the canonical experience block, or `null`
- `frame_as`: generator-facing framing string, or `null`

Backward-compat rule: if `gap_directives` is missing or empty, generators behave exactly like v4. If a tech swap omits `target_role`, the swap remains unscoped.

**v13 judge prompt changes (prompt only, no schema change):**
- `frame_as` expanded from 1-sentence to 2–3 sentence structured brief: (1) role context at
  `target_role`, (2) adjacent evidence from canonical bullets, (3) execution angle. The
  1-sentence constraint was the root cause of both hedge-poisoned `frame_as` strings and
  excessive conservatism on `fabricate` directives.
- Banned phrase family added to `frame_as` guidance — judge may not emit hedging language
  (foundational knowledge of, analogous to, comparable to, transferable skills, etc.) in
  `frame_as`. The generator's style linter would reject these if they reached the output.
- Output format example updated to show a multi-sentence `frame_as` brief.
- Fabricate plausibility test rewritten: old test was "would a cold HM notice?" (detectability);
  new test is "do the canonical bullets provide enough contextual fit?" (fit). The old test
  caused 70 `acknowledge` vs 5 `fabricate` across 84 jobs. `acknowledge` directives are silently
  dropped from the resume prompt — they only reach the cover letter. 70 acknowledges = zero
  resume impact.

Two retry layers remain: HTTP-level (1 retry on network error, 2s backoff) and validation-level (1 retry on Zod failure, 2s backoff). After the validation retry fails, v10 writes the raw payload plus schema error to `output/logs/judge_failures/{run_id}_{job_id}.json`; the capture path is best-effort and never crashes the pipeline.

v10 judge hard blockers: prior-employer-only restrictions (for example `Ex-American Express only`) are WEAK unless the employer appears in the work-history block; active credentials the candidate does not have (Top Secret clearance, Series 7, CPA, PE license, etc.) are also WEAK. Fabricate directives must pick the role with strongest contextual fit, not merely the newest role.

`getBucket(judgeResult, totalScore)` still routes STRONG+score≥0.70 → COVER_LETTER, STRONG+score<0.70 → RESULTS, MAYBE → REVIEW_QUEUE, WEAK or judge error → ARCHIVE.

Real-data validation confirmed (2026-04-25): judge correctly identified Citi (named enterprise, fintech domain) and TD Bank (major bank, fintech domain) as STRONG; correctly flagged KeyCorp as MAYBE for React gap; correctly flagged staffing agency role as MAYBE for unnamed end client.

### `cover-letter/` — BUILT (v5 consumer)

Model switched from `google/gemma-4-31b-it` to `deepseek/deepseek-v4-flash` since v5. Artifact output now lands with the paired resume under `output/applications/{YYYY-MM-DD}/{run_label}/{slug}/`. Retry-once remains available; v10 sets `max_tokens=3000` and `retries=1`.

Current brief source is the verbatim EXPERIENCE slice built by
`src/cover-letter/resume-brief.ts::buildExperienceBlockFromCanonicalTex()`.
The prompt includes a non-negotiable employer-attribution rules block and a
paragraph-scope employer rule to stop cross-employer fabrication (Bug E).
v5 gap-directive consumption is additive:

- `acknowledge` directives are surfaced explicitly for honest body coverage
- `fabricate` directives are surfaced as silent claim guidance
- `forbid` directives are listed as never-claim constraints
- if directives are absent, the prompt stays at v4 behavior

v10 consistency and safety additions:

- hardcoded employer-stack assertions were replaced by dynamic `ACTIVE_TECH_SWAPS` and `FABRICATED CLAIMS THE RESUME HAS MADE`
- `looksTruncated()` retries bodies that do not end in sentence punctuation and fails cleanly if the retry is still truncated
- `stripDashes()` removes em/en dash forms before LaTeX assembly
- `hasBannedStylePhrase()` rejects bridge phrases such as "analogous to", "demonstrating transferable", "translate directly to", and "comparable to"

**v13 cover-letter additions:**
- Experience block passed to cover letter generator is now swap-aware: `applyScopedTechSwaps`
  applies each swap only within the employer section matching `target_role`; unscoped swaps
  apply globally. Eliminates the LLM receiving contradictory inputs (pre-swap experience block
  vs `ACTIVE_TECH_SWAPS` instruction).
- Transient API errors (empty content, terminated stream, OpenRouter 5xx) use a separate retry
  counter and do not consume content-quality retry attempts. Confirmed fix for the pattern where
  two consecutive `OpenRouter returned empty content` errors exhausted the retry budget.

Live v10 validation (2026-05-27, `SOURCE=jobright_api MAX=10`) wrote 5 cover letters, 370–503 words, with `cover_letter_gen_failed=0` and `cover_letter_length_off=0`.

### `resume-generator/` — BUILT (v5 consumer)

Total-mode LaTeX tailoring remains the only execution path. The old
word-count-based retry path (`word_count < 1900`) was removed from
`src/resume-generator/index.ts`; short outputs are now flagged with
`resume_too_short` but not regenerated automatically.

v5 prompt consumption is additive:

- scoped `tailoring_hints.tech_swaps[]` now honor `target_role` when present
- optional `gap_directives[]` drive fabricate/reframe/forbid guidance
- absent fields fall back to the exact v4 behavior

No new LLM call was added; the same single resume-generation call now receives
more structured judge context.

v10 hard guards:

- `stripDashes()` is applied before save/compile
- `hasBannedStylePhrase()` rejects bridge-style outputs before save
- `replaceSkillsSection()` replaces the generated SKILLS block with the canonical SKILLS block before save/compile, making SKILLS atomicity enforceable rather than merely prompted
- short resumes still set `resume_too_short`, but word-count retry remains removed
- v11 extracts the LaTeX document from wrapped model responses before strict
  validation, which makes `deepseek/deepseek-v4-pro`-style prose wrappers less
  likely to fail the whole resume generation. Remaining failures preserve
  diagnostic `error` strings in combined metadata.
- v11 supports premium model routing for high-value jobs: STRONG + score >=
  `premium_min_score` can use `premium_model` with streaming first, then falls
  back to Flash on any premium failure. Post-processing also bolds numeric
  outcomes inside `\item` lines before save/compile.

**v13 resume-generator additions:**
- `VOICE AND POSITIONING` section added to `TOTAL_MODE_PROMPT`: never undersell, reframe tasks
  as achievements, lead with strong action verbs, end every bullet with result/impact.
- `replaceSkillsSection()` is now swap-aware: accepts optional `techSwaps`, applies them
  deterministically to canonical SKILLS before restoring the section. Canonical is still the
  hallucination-protection base; approved judge swaps now survive post-processing.
  Call site passes `input.tech_swaps`.
- `boldMetrics` regex fixed to handle one level of nested `\textbf{}` braces, eliminating
  compile failures caused by LLM-generated `\textbf{\textbf{content}}`.
- Generator prompt explicitly forbids nested `\textbf{}` inside another `\textbf{}`.
- Premium model stream abort now retries once silently (5s backoff) before falling back to
  Flash — handles transient OpenRouter slowness killing the stream at the 300s timeout.

### `dedup/` — BUILT

Two complementary mechanisms.

**Cross-run exact dedup (`src/dedup/redis.ts`)**: Redis SET with per-key TTL. Key shape `seen:{source}:{job_id}`, value `"1"`, TTL 7 days. `isSeen()`, `markSeen()`, `listSeenJobIds()` — all non-throwing, gracefully no-op when Redis is down. `_connectionFailed` flag prevents repeated reconnect attempts.

**Cross-site semantic dedup (`src/dedup/pgvector.ts`)**: pgvector cosine similarity on the `jobs.embedding` column (HNSW index). Default threshold 0.88, lookback 7 days. Non-throwing — returns null on any DB error.

Real-data validation confirmed (2026-04-25): second run against same 10 Dice jobs produced 9/9 DEDUP correctly. All jobs from first run were marked seen in Redis; second run correctly skipped all of them without re-processing.

### `storage/` — BUILT (v4.1 + v5.1)

Postgres + pgvector persistence.

- `src/storage/db.ts` — `pg.Pool` singleton with `describeErr` formatting on the error listener.
- `src/storage/persist.ts` — `saveRun`, `finishRun`, `saveJob`, `isSeenInDB`. All non-throwing. v4.1: `pool.connect()` inside try block, `markStorageDisabled`, `formatErr`. v5.1 additions: `updateHeartbeat` (Postgres helper — available for callers; the orchestrator runner writes heartbeats via its own inline SQL rather than calling this function), `markRunExitCode` (same — available but runner writes exit code via its own SQL; ghost reaper calls this directly), `getUnfinishedRuns` (ghost reaper query — hits partial index), `getRunStats` (monitor post-run check).
- v11 adds `jobHasCompleteArtifacts(job_id)`, used by manual generation to
  distinguish "some stale/failed artifact row exists" from "latest resume and
  latest cover are both healthy." This is what lets the UI repair failed manual
  generations instead of being blocked by partial history.
- Persistence note: the silent-error swallow / `markStorageDisabled` / "continuing without persistence" behavior remains in place by locked decision. The `005_tailored_artifacts.sql` cleanup removed the most common migration-replay cascade, but the gating model itself is unchanged.
- `src/storage/migrate.ts` — runs SQL files in `migrations/` in alphabetical order.
- `src/storage/integrity.ts` — `verifyIntegrity`. Gated on `VERIFY=1`.
- `src/storage/types.ts` — `RunRecord`, `RunStats` (gains `extractions_attempted`, `extractions_succeeded` in v5.1), `JobRecord`.
- `migrations/001_initial.sql` — full schema (unchanged from v5).
- `migrations/002_orchestrator.sql` — new in v5.1: 4 columns + partial index on `runs`.
- `migrations/005_tailored_artifacts.sql` — cleaned up to create only `tailored_resumes` + two indexes. The stale `cover_letters` block and transient `version` column were removed to stay replay-safe with `006_consolidate_artifacts.sql`.
- `migrations/008_visa_enum.sql` — migrates `jobs.visa_sponsorship` from boolean-era semantics to the five-state text enum (`offered`, `denied`, `ead_eligible`, `payment_model_only`, `unmentioned`) and adds `jobs.visa_quote`.
- `migrations/009_cover_letter_artifact_columns.sql` — adds missing cover-letter artifact columns on `cover_letters` for clean installs (`tex_path`, `pdf_path`, `meta_path`, `prompt_sha`, `canonical_sha`, token counts, `compile_status`, `generated_by`, `flags`).
- `migrations/010_ledger_run_id_text.sql` — aligns `fabrication_ledger.run_id` from `UUID` to `TEXT` to match `runs.run_id` and support `manual-...` run ids.
- `migrations/011_ledger_truth_distance_numeric.sql` — changes `fabrication_ledger.truth_distance_score` from `INTEGER` to `NUMERIC`, required for fractional risk-map truth-distance scores.
- `test/persist.test.ts` — 14 tests. All pass against updated `finishRun` — disabled-state tests don't touch SQL, compile-time enforcement handles the new fields at the call site.

### `risk-map/` — BUILT (v2 / Bug F hardening)

`src/risk-map/` now does two distinct jobs:

- pre-judge risk enrichment for JD skills
- post-generation audit of tailored artifacts

`src/risk-map/audit.ts` includes `auditRoleAttribution()`, which compares
generated bullets to canonical bullets per employer and flags role-mixing tech
claims. New ledger change type: `fabricated_role_attribution`. New summary
counter: `risk_summary.counts.fabricated_role_attribution`. The underlying
`fabrication_ledger` table schema is unchanged.

v10 adds `applyResumeAttributionOverrunFlag()`: if
`risk_summary.counts.fabricated_role_attribution > 3`, resume artifact flags get
`resume_attribution_overrun`. The resume still writes to disk; the flag is a
soft gate for human review before applying.

**v13 risk-map changes:**
- `hasOverlap` replaced with Jaccard content-word matching (threshold 0.45, stop-word filtered).
  The old 5-word consecutive run check over-counted rewritten bullets as fabricated because
  LLMs paraphrase. 30/84 jobs (36%) were flagged `resume_attribution_overrun` — almost certainly
  inflated. Jaccard handles paraphrasing correctly. Overrun threshold (`fab > 3`) unchanged
  pending first clean batch to calibrate from real detection data.
- `requires_human_review` set to `false` on 148 `direct_equivalent` entries that are pure naming
  variants or obvious synonyms (S3/AWS S3, React/ReactJS, REST APIs/REST, Version control/Git,
  etc.). 35 entries kept `true` for concept-to-tool mappings. Reduces yellow badge noise from
  every swap to only genuinely interview-questionable mappings.
- 13 Phase-8 entries restored to additive structure: both `adjacent` and `direct_equivalent`
  entries now coexist in both indexes, so `lookupJdSkill` returns the best by distance.
- 28 new `direct_equivalent` entries for 2025–2026 Java JD vocabulary: RDS, Aurora, ECS, ECR,
  CloudFront, Azure SQL, ACR, Azure Container Registry, AAD, Azure Active Directory, Key Vault,
  Pub/Sub, Cloud Run, GitLab CI, CircleCI, ArgoCD, Grafana, OpenTelemetry, Hibernate, MariaDB,
  SNS, Postman, gRPC, OWASP, Jira, Confluence, Terraform, SNS. Total `direct_equivalent`
  entries: 200 (was 172).

### `shared/` — BUILT

**v13 shared additions:**
- `src/shared/utils.ts` (new file): `escapeRegexStr`, `applyTechSwaps` (word-boundary-safe
  lookarounds, handles multi-word tech names), `applyScopedTechSwaps` (applies each swap only
  within the employer section containing `target_role`; unscoped swaps apply globally).
- `src/shared/style-lint.ts`: three new banned patterns added — `aligning with your need for`,
  `as required by the role`, `gained hands-on exposure`. Zero false-positive risk; these phrases
  never appear in legitimate professional writing.

### `ui-server` + `ui/` — BUILT (new in v7)

**`scripts/ui-server.ts`** — single Express file. Runs on **port 3001** (the default port is occupied). On startup: runs migration 004, then serves the app. In production, serves `ui/dist` as a static SPA. In dev, the Vite dev server (`cd ui && npm run dev`, default port 5173) proxies `/api/*` to `:3001`.

**Endpoints:**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/apply-queue` | COVER_LETTER + REVIEW_QUEUE + RESULTS jobs. Sort: age bucket (< 24h → 24–72h → > 72h) then score DESC within each bucket. |
| `GET` | `/api/rejections-hard` | REJECT jobs grouped by reason. Sort: reason ASC, scraped_at DESC. |
| `GET` | `/api/rejections-soft` | ARCHIVE jobs. Sort: score DESC (closest calls first). |
| `GET` | `/api/stats` | `{ pending, applyLater, applied, hardRejectionsUnreviewed, softRejectionsUnreviewed }` |
| `POST` | `/api/label` | Upsert into `labels`. Body: `{ job_id, run_id, label, application_status?, notes? }`. COALESCE on update: re-labeling never clears a prior `application_status` or `notes` unless the new payload explicitly provides a non-null value. |

**Cover letter file resolution:** `cover_letters.content` is always NULL (pipeline writes to disk only). The server reads from `cover_letters.file_path`, with a path-substitution fallback from `/Downloads/project/` to `/Downloads/jobs/` to handle the historical repo rename.

**Manual generation:** `POST /api/jobs/:job_id/generate` calls
`src/artifacts/manual-generate.ts`. If `force=false`, it conflicts only when
the latest resume and cover are both complete. Missing/failed resume or cover
artifacts can be generated again from the same UI card. Every attempt writes a
compact `output/logs/runs/{YYYY-MM-DD}/manual_{timestamp}_{run-folder}_{jobid}.log`.

**`ui/`** — Vite + React 18 + TypeScript SPA. No router, no state library, no CSS framework. Key design decisions:
- `JobCard.tsx` is a single shared component with `mode: 'apply' | 'hard-reject' | 'soft-reject'` prop — ~80% of rendering logic is shared across all three tabs.
- Three secondary action buttons in Apply Queue: `Applied`, `Apply Later`, `Not Applied`. `apply_later` cards stay in Pending filter with a purple badge; `applied`/`skipped` cards move to their respective filter.
- Quick-fill note chips (4 presets) appear on any labeled card. For label=No in apply mode, clicking a chip triggers an immediate POST and moves the card to Not Applied. For Yes/Maybe or other tabs, chips fill the textarea only.
- `notes` textarea is always pre-populated from `labels.notes` — single source of truth for all user-typed context. Every POST sends the current textarea value so displayed and stored values are always in sync.
- Stats header updates after every label action without page reload.

**Start commands:**
```bash
# Production (serves built UI)
npx tsx scripts/ui-server.ts         # → http://localhost:3001

# Dev (hot reload)
cd ui && npm run dev                 # → http://localhost:5173 (proxies /api → :3001)

# Build UI for production
cd ui && npm run build               # → ui/dist/
```

### `orchestrator/` — BUILT (new in v6, log naming refreshed in v9)

Run-level orchestration. Schedules `run-pipeline.ts` via node-cron, prevents overlapping runs with a Redis lock, captures failures, and emits warnings on degraded conditions. Zero changes to `run-pipeline.ts` beyond the `RUN_ID` env var and the two `finishRun` fields.

**Files:**

- `src/orchestrator/index.ts` — entry point. Boots cron schedules, handles SIGTERM/SIGINT (stops new ticks, allows in-flight runs to finish via runner's own SIGTERM forwarding). Unhandled rejection safety net logs and continues rather than crashing the scheduler.
- `src/orchestrator/scheduler.ts` — cron definitions per source + ghost reaper tick. Uses a per-schedule `running` flag to guard against slow ticks overlapping with the next fire of the same expression.
- `src/orchestrator/runner.ts` — acquires lock, spawns `run-pipeline.ts` as a child process, pipes stdout/stderr to both the terminal and timestamped source-labeled run logs, sends heartbeat `UPDATE` to Postgres every 60s via its own inline SQL (not via `src/storage/persist.ts`), writes `exit_code` on child exit via its own inline SQL, calls monitor, releases lock. SIGTERM forwarding: sends SIGTERM to child, waits 30s for clean exit, SIGKILLs if still running. `pLimit(5)` in the pipeline means in-flight jobs complete and `finishRun` runs cleanly before the process exits.
- `src/orchestrator/lock.ts` — Redis `SET NX EX` wrapper. `acquireLock` returns `run_id` on success, `null` if held or Redis down. `releaseLock` uses `DEL` — idempotent, safe to call on missing or expired key. `REDIS_URL` read inside `getClient()` on each new client creation (not at module load), so tests can override the env var.
- `src/orchestrator/monitor.ts` — post-run stats check. Three warning conditions: (1) `jobs_total === 0` — scraper produced nothing (broken selectors, auth expired, IP blocked); (2) `extractRate < 0.5 && attempted > 5` — extraction degraded (OpenRouter credits, rate limit); (3) `jobs_passed > 10 && jobs_covered === 0` — pipeline degraded end-to-end. Writes success line on clean runs. Run logs now include timestamp + source labels for easier triage. The `> 5` guard on condition 2 correctly suppresses the warning when all jobs were deduped before extraction ran (`attempted = 0`).

**Cron schedule:**

| Source | Expression | POSTED_WITHIN | MAX | TTL |
|---|---|---|---|---|
| Dice daily (Mon–Sat) | `0 9,13,17,21 * * 1-6` | ONE | 50 | 4h |
| Dice backfill (Sun 9am) | `0 9 * * 0` | SEVEN | 100 | 6h |
| Dice Sun afternoons | `0 13,17,21 * * 0` | ONE | 50 | 4h |
| Jobright API (Mon–Sat) | `0 9,13,17,21 * * 1-6` | — | 40 | 4h |
| Jobright API (Sun afternoons) | `0 13,17,21 * * 0` | — | 40 | 4h |
| LinkedIn (daily) | `0 14 * * *` | — | 30 | 4h |
| Ghost reaper | `*/10 * * * *` | — | — | — |

LinkedIn is offset from Dice by 1h to avoid hitting OpenRouter simultaneously from multiple sources. Jobright runs via the **Jobright API** on the same cadence as Dice (MAX=40 to stay under Jobright rate limits). Sunday 9am uses the backfill config only — the `1-6` constraint on the daily schedule prevents a conflict. Sunday afternoons get their own schedule so they're not dark after the backfill.

**Ghost reaper:** Runs every 10 minutes. Finds `runs` rows where `finished_at IS NULL AND last_heartbeat IS NOT NULL AND last_heartbeat < NOW() - '5 minutes'::INTERVAL` (these are processes that died without calling `finishRun` — OOM, SIGKILL, hard crash). For each ghost: releases the Redis lock unconditionally, sets `exit_code = -1`, sets `finished_at = NOW()`. Writes to `output/logs/reaper.log`. Note: the `last_heartbeat IS NOT NULL` guard means pre-migration rows and runs shorter than 60s (never got a heartbeat) are correctly ignored.

**Tests (`test/`):**
- `lock.test.ts` — 8 tests: Redis-down contract (3, no infra needed) + real Redis (5, run via `npm run test:infra`). Tests: acquire when free, acquire when held, release allows re-acquire, release idempotent, isLockHeld before/after.
- `runner.test.ts` — 5 tests: lock and monitor are stubbed. Tests: acquireLock called with correct args, returns -1 when lock not acquired, releaseLock not called when lock skipped, monitor not called when lock skipped, mock infrastructure wired correctly.
- `reaper.test.ts` — 3 tests (run via `npm run test:infra`): ghost row gets `exit_code=-1` and `finished_at` set, healthy row untouched, pre-migration row (null heartbeat) ignored.

**Entry point:** `npm start`

**One-shot trigger for testing:** `npx tsx src/orchestrator/trigger-once.ts`

Direct `npx tsx scripts/run-pipeline.ts` runs now also write
`output/logs/runs/{YYYY-MM-DD}/log_{timestamp}_{run-folder}_{source}_{runid}.log` unless
`PIPELINE_DISABLE_RUN_LOG=1` is set.

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

**Why:** Four concrete reasons. First, **inter-stage data passing cost**: BullMQ requires all job data to be serialized into Redis between stages. `Float32Array(384)` embeddings, `description_raw` text (up to 12KB per JD), and full extracted JSON must round-trip through Redis 7 times per job. This is pure overhead for data that currently lives in memory for 20–40 minutes. Second, **`run_id` model breakage**: the entire Postgres schema (`runs`, `jobs`, `filter_results`, `scores`, `judge_verdicts`, `cover_letters`, `seen_jobs`), the output directory structure (`output/cover-letters/{run_id}/`), and `saveRun`/`finishRun` are all built around a run as one atomic execution. With per-stage queues, "a run" stops being a coherent unit — jobs from run A would be in the extract queue when run B starts. Third, **solved problem**: `pLimit(5)` handles per-job concurrency, `throttle_ms=100` handles LLM rate limiting — the two things BullMQ would provide are already built. Fourth, **testing cost**: moving each stage into a BullMQ worker would require rewriting the wiring code that connects all modules, without adding capability. 232 tests would need re-verification.

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

17. **Labeling CLI + labels table for M9 calibration.** A `labels(job_id, run_id, label, notes, labeled_at)` table and `src/storage/label-cli.ts` CLI allow fast manual ground-truth labeling of judged jobs (y/m/n/skip/quit), enabling future scoring weight calibration against real data.

---

## 12. Known issues and open decisions

### Open — code drafted, not landed

1. **Two-phase pgvector dedup (hash gate).** Current `findSemanticDuplicate` runs the expensive cosine query directly. Phase 1 hash gate `(normalized_company + normalized_title) LIKE` was drafted but not landed. Low priority while volume stays under ~100 jobs/run.

### Open — additional fixtures to capture

### Open — calibration

2. **Scoring not calibrated on real data.** Weights (0.35/0.25/0.15/0.15/0.10) and threshold (0.50) are designed values. M8 is now done — real run history is accumulating. After ~50 labeled jobs from unattended runs, manually rank "would apply / maybe / no" and tune against ground truth. This is now unblocked.

3. **Attribution overrun threshold needs recalibration after v13 Jaccard fix.**
`src/risk-map/audit.ts` threshold `fab > 3` was calibrated against the old
5-word-run detection, which over-counted rewritten bullets as fabricated. After
running a full batch with the new Jaccard detection, inspect the distribution
of `fabricated_role_attribution` counts in `meta.json` for jobs without
`pdf_compile_failed` or `resume_gen_failed`. Set the threshold at the 80th
percentile of those counts. Expected new threshold: somewhere in the 5–8 range.
Do not change the threshold before seeing real data.

### Open — operational reminders

5. **Cookie rotation (Jobright).** Jobright runs via the API path (`jobright_api`) but still relies on an authenticated session. If Jobright starts returning auth errors / empty results, rotate cookies via browser extension → `config/cookies/jobright.json` (never commit).

6. **OpenRouter credit.** Confirmed failure mode from testing: a 401 `User not found` error causes every extraction in a run to fail silently from the pipeline's perspective (jobs archive with `extraction_failed` flag). The monitor now catches this (condition 2: `extractRate < 0.5 && attempted > 5`) and emits a warning. Top up before credits run out. At projected volume (~$0.50–1.00/day) a $10 deposit lasts 2–3 weeks.

7. **Jobright HTML scraper selectors are fragile (fallback only).** The Playwright HTML scraper (`jobright.py`) uses CSS-module hashed class names that can break on frontend rebuilds. It’s kept as a fallback; the primary path is `jobright_api.py`.

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
- ✅ **Milestone 9 — Review UI**: Local web UI at `localhost:3001`. Three tabs: Apply Queue (time-decayed sort, apply/apply-later/not-applied tracking), Hard Rejections (grouped by reason), Soft Rejections (score DESC). Full labeling, note chips, relative time display. Migration 004 live.

### Active: Scoring calibration

Now unblocked by M9 (UI built). Labeling can start immediately.

Steps:
1. Use the Apply Queue and rejection tabs to label jobs yes/maybe/no (already has 58+ existing labels).
2. After ~50 additional labels, compare against `(score.total, judge.verdict)` pairs.
3. Tune the five scoring weights (0.35/0.25/0.15/0.15/0.10) and the gate threshold (0.50) against ground truth.
4. Capture more real-data extraction fixtures during this pass (target: 5 total).

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
cd scraper
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
tail -f output/logs/runs/<YYYY-MM-DD>/log_<timestamp>_<run-folder>_<source>_<runid>.log
```

### Review UI

```bash
# Build the UI (first time, or after UI source changes)
cd ui && npm install && npm run build && cd ..

# Start the API server (serves built UI at localhost:3001)
npx tsx scripts/ui-server.ts

# Dev mode (hot reload — run alongside the server)
cd ui && npm run dev     # → http://localhost:5173
```

### Unattended mode (production)

```bash
npm start
# Logs accumulate in output/logs/orchestrator.log
# Cover letters appear in output/cover-letters/{run_id}/COVER_LETTER/
# Review queue in output/cover-letters/{run_id}/REVIEW_QUEUE/
```

### Default manual pipeline command

```bash
POSTED_WITHIN=ONE EXTRACT=1 SOURCE=dice MAX=20 \
  npx tsx scripts/run-pipeline.ts
```

Use this command for normal day-to-day manual runs. It means:

- `SOURCE=dice` — scrape Dice
- `MAX=20` — inspect up to 20 listings
- `POSTED_WITHIN=ONE` — only listings from the last 24 hours
- `EXTRACT=1` — enable extraction; scoring, judge, and cover routing auto-enable
- resume generation is enabled by default unless `DO_RESUME=0` or `DO_RESUME=false`
- cover-letter generation is enabled by default unless `DO_COVER=0` or `DO_COVER=false`
- direct-run logs are written to `output/logs/runs/{YYYY-MM-DD}/log_{timestamp}_{run-folder}_{source}_{runid}.log`

`EXTRACT=1` and `EXTRACT=true` both work because the pipeline treats any
non-empty `EXTRACT` value as enabled. Prefer `EXTRACT=1` in docs for
consistency.

Only jobs routed to `COVER_LETTER` or eligible `REVIEW_QUEUE` produce resume and
cover artifacts. A run can complete correctly and still generate no artifacts if
no jobs pass score/judge routing.

### Advanced manual pipeline commands

Use these only for the specific scenario named in the comment.

```bash
# Same as the default command, but explicit about artifacts
POSTED_WITHIN=ONE EXTRACT=1 DO_RESUME=true DO_COVER=true SOURCE=dice MAX=20 \
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

Direct pipeline runs now print and write a run log under
`output/logs/runs/{YYYY-MM-DD}/log_{timestamp}_{run-folder}_{source}_{runid}.log`.

### Command cookbook by scenario

```bash
# Run migrations before a pipeline run
npm run migrate

# Typecheck only
npm run build

# Full unit test suite
npm test

# Run one small Jobright validation batch
EXTRACT=1 SOURCE=jobright_api MAX=10 \
  npx tsx scripts/run-pipeline.ts

# Run one larger Jobright validation batch
EXTRACT=1 SOURCE=jobright_api MAX=50 \
  npx tsx scripts/run-pipeline.ts

# Run Dice backfill with artifacts; DO_* flags shown for clarity, but redundant
POSTED_WITHIN=SEVEN EXTRACT=1 DO_RESUME=true DO_COVER=true SOURCE=dice MAX=100 \
  npx tsx scripts/run-pipeline.ts

# Audit historical generated artifacts
npm run audit:artifacts

# Find jobs in a run missing resumes
find output/applications/<run-folder> -mindepth 2 -maxdepth 2 -name meta.json -print \
  | while read f; do jq -e '.resume.tex_path != null' "$f" >/dev/null || echo "$f"; done

# Inspect one failed resume block
jq '.resume' output/applications/<run-folder>/<job-folder>/meta.json

# Retry manual artifact generation for one job id
npx tsx -e "import { manualGenerateArtifacts } from './src/artifacts/manual-generate.ts'; const out = await manualGenerateArtifacts(process.cwd(), '<job_id>', { force: true }); console.log(JSON.stringify(out, null, 2));"

# Inspect newest manual generation output
latest_manual="$(find output/applications -type d -name 'manual_*' | sort | tail -1)"
printf '%s\n' "$latest_manual"
find "$latest_manual" -name meta.json -o -name resume.tex -o -name cover_letter.tex

# Tail newest direct/manual run logs
find output/logs/runs -type f | sort | tail
tail -f output/logs/runs/<YYYY-MM-DD>/<log-file>

# Inspect captured judge schema failures
ls output/logs/judge_failures
jq '.' output/logs/judge_failures/<run_id>_<job_id>.json

# Check generated artifacts for banned bridge phrases
grep -rnE 'demonstrating transferable|analogous to|akin to|whose syntax (and|or) features|foundational knowledge of|directly applicable to|immediately useful in' \
  output/applications/<run-folder>/**/resume.tex output/applications/<run-folder>/**/cover_letter.tex

# Check generated artifacts for em/en dash forms
grep -rnP '(--|---|[\u2013\u2014])' \
  output/applications/<run-folder>/**/resume.tex output/applications/<run-folder>/**/cover_letter.tex
```

### Infra tests (real Redis + Postgres required)

```bash
npm run test:infra
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
8. Orchestrator schedules live in `src/orchestrator/scheduler.ts` — that is the single source of truth for when the pipeline runs.

---

## 16. Glossary

- **Hard filter** — deterministic rule-based stage. Rejects using listing metadata only.
- **JD** — job description (full body text, fetched separately from listing).
- **PASS / REJECT / DEDUP** — hard filter + Redis dedup outcomes.
- **GATE_PASS / ARCHIVE** — scoring gate outcomes (score above/below 0.50 threshold).
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
- **markStorageDisabled** — module-level boolean in `src/storage/persist.ts`. Set after a startup failure so subsequent persist calls become silent no-ops.
- **Ghost run** — a `runs` row where `finished_at IS NULL` and `last_heartbeat` has gone stale (> 5 minutes). Indicates the child process died hard without calling `finishRun`. Cleaned up by the ghost reaper with `exit_code = -1`.
- **Ghost reaper** — cron task in `src/orchestrator/scheduler.ts` that runs every 10 minutes. Detects ghost runs, marks them terminal, releases their Redis locks.
- **Heartbeat** — `UPDATE runs SET last_heartbeat = NOW()` sent every 60s by the orchestrator runner while a child process is alive. Enables ghost detection.
- **Lock** — Redis key `orchestrator:lock:{source}` with `SET NX EX`. Prevents two pipeline runs for the same source from overlapping. TTL is the safety net; the runner also releases it explicitly on clean exit.
- **Monitor** — post-run function in `src/orchestrator/monitor.ts`. Checks three warning conditions after each run and writes to `output/logs/orchestrator.log`.
- **Run-level orchestration** — the architectural pattern where the orchestrator schedules and supervises full pipeline runs as atomic units, rather than managing individual pipeline stages as separate queue workers.
- **Apply Queue** — the first tab of the Review UI. Shows COVER_LETTER + REVIEW_QUEUE + RESULTS bucket jobs sorted by time-decayed score (< 24h → 24–72h → > 72h, score DESC within each bucket).
- **application_status** — `labels` column tracking what the user did from the UI: `applied`, `skipped` (Not Applied), or `apply_later`. NULL for calibration-only labels written by `label-cli.ts`.
- **apply_later** — application status meaning "I want to apply to this but not right now." Card stays in the Pending filter with a purple badge. Does not count as applied or skipped.
- **Not Applied** — UI term for `application_status = 'skipped'`. DB value kept as `skipped` for backward compatibility.
- **Note chips** — preset quick-fill buttons on each card in the Review UI (e.g. "Not a good fit"). Clicking a chip for a No-labeled card immediately POSTs and moves the card to Not Applied.
- **Time-decayed sort** — Apply Queue sort order: jobs bucketed by age (< 24h, 24–72h, > 72h), sorted by score DESC within each bucket. Ensures freshest high-scoring jobs appear first.
- **Banned bridge phrase** — tailoring language that reveals a fabricated or adjacent claim, such as "analogous to", "demonstrating transferable", "translate directly to", or "comparable to". Runtime style lint rejects these.
- **SKILLS atomicity** — generated resumes must preserve the canonical SKILLS section exactly. v10 enforces this by replacing the generated SKILLS block with the canonical block before save.
- **`frame_as`** — the 2–3 sentence brief in a `gap_directive` that tells the resume/cover-letter generators the role context, adjacent evidence, and execution angle for a fabricate or reframe directive. Formerly a 1-sentence string; expanded in v13 to prevent hedge-phrase contamination and under-specification.
- **`applyScopedTechSwaps`** — shared utility that applies tech swaps to a plain-text experience block with `target_role` scoping. Scoped swaps (target_role non-null) apply only within the employer section containing the target_role string; unscoped swaps apply globally.
- **Jaccard content-word matching** — the v13 replacement for the 5-word consecutive run heuristic in `auditRoleAttribution`. Measures whether a generated bullet shares ≥45% of unique non-stop content words with any canonical bullet at the same role. Handles LLM paraphrasing correctly.
- **`requires_human_review`** — risk map flag on each `direct_equivalent` entry. When `true`, any resume containing a claim graded to that entry generates a yellow badge in the UI. Set to `false` for pure naming variants (S3/AWS S3, React/ReactJS, etc.) and `true` for concept-to-tool mappings where interview depth questions are plausible (EKS/Kubernetes, Memcached/Redis, ETL scripting/Python, etc.).

---

## 17. Reference documents

- `THE-BIBLE-v1.md` — original architecture snapshot. Keep as the only Bible archive.
- `THE-BIBLE-LATEST.md` — current living document. All version history rolls forward here.
- `UI-BUILD-INSTRUCTIONS.md` — full spec for the Review UI (v1 base + Delta 2 changes)
- `design-v4.md` — design doc covering scoring/judge contracts
- `STORAGE-CHANGES.md` — v4.1 changeset detail (saveJob fix, formatErr, markStorageDisabled)
- `fixtures/extractor/` — synthetic + real extraction test cases
- `fixtures/judge/` — judge test cases
- `migrations/001_initial.sql` — full schema
- `migrations/002_orchestrator.sql` — orchestrator columns + partial index
- `migrations/003_labels.sql` — manual labeling table (label, notes, labeled_at)
- `migrations/004_ui_application_tracking.sql` — application_status + applied_at + apply_later constraint
- `migrations/007_fabrication_ledger.sql` — fabrication ledger table
- `migrations/008_visa_enum.sql` — five-state visa enum migration
- `migrations/011_ledger_truth_distance_numeric.sql` — `fabrication_ledger.truth_distance_score` INTEGER → NUMERIC (required for fractional risk-map truth-distance scores)
- `docker-compose.yml` — local services

---

## 18. Artifact-generation change log

Recorded here to make artifact-generation changes traceable without requiring
multiple Bible archive files.

### 18.1 — Run-folder layout

After initial v8 implementation, observed that flat `output/applications/{slug}/`
made it impossible to track which pipeline run produced which artifacts. That
first patch nested under run folders; the latest layout also groups by day:

  `output/applications/{YYYY-MM-DD}/{run_label}/{slug}/...`

where `run_label` is:
- pipeline: `{ISO timestamp}_{run_id first 8}` e.g. `2026-05-14T10-30-15_9e27688e`
- manual:   `manual_{ISO timestamp}` e.g. `manual_2026-05-15T09-15-30`

DB unchanged. `tex_path` / `pdf_path` columns store full relative path including
date folder plus run folder. Existing older layouts stay where they are; new
generations land in date-grouped run folders.

### 18.2 — Risk map + fabrication ledger (no policy modes)

After v4 fixes, added the tech equivalence risk map at
`config/tech-equivalence-risk-map.json` and wired it into the pipeline as follows:

- `src/risk-map/` module loads the map at startup and exposes lookups + audit
- Judge prompt v4/v5 attaches risk entries to JD skills and emits `tech_swaps`
- Resume + cover letter generators apply `tech_swaps` (Mode B substitution)
- Post-generation audit grades every claim and writes ledger rows
- `meta.json` per artifact has `risk_summary` + `export_status`
- UI shows green/yellow badges based on `export_status` (no red)
- Verifier uses risk map for synonym/equivalent matching

Policy modes (strict / research / chaos_measurement) were specced and dropped
before implementation. Single-user system, total mode is the only intended use.
Risk map data still drives ledger + human_review badges. If we ever multi-user
the system, modes return as a per-user setting.

**Tables added:**
- `fabrication_ledger` — one row per claim made by any generation, ever.
  Columns: id, job_id, run_id, artifact_type, jd_skill, canonical_skill_found,
  generated_skill_or_claim, change_type, truth_distance_score, fabrication_risk,
  location, human_review_required, created_at.

**Migration:** `migrations/007_fabrication_ledger.sql`.

**UI changes:**
- Two badge colors only: green (ok) and yellow (needs_review)
- Clicking yellow opens a panel listing `human_review_items` + reasons
- PDF links always active; no export blocking

**Verified on production run (2026-05-14):** 170 ledger rows, distribution
117 exact / 33 direct_equivalent / 20 adjacent / 0 high-risk. 35 human_review_items
surfaced via yellow badge. `tech_swaps` key present in every artifact's
`tailoring_hints` (empty array when no swap applies, which is correct).

### 18.4 — Judge v5 additive planner

Judge v5 extends the v4 risk-aware output without changing the number of model
calls and without adding a new persistence column. Publicly, the schema adds:

- top-level optional `gap_directives[]`
- optional `target_role` on each `tailoring_hints.tech_swaps[]`

`gap_directives[]` drive employer-scoped fabrication/reframe/acknowledge/ignore/
forbid behavior in downstream generators. Storage remains additive by mirroring
`gap_directives` into the persisted `tailoring_hints` JSONB blob for round-trip
manual regeneration, while the in-memory generator contracts still expose
`gap_directives` as a top-level field. If the judge omits the new fields, resume
and cover-letter generation behave exactly as v4.

**Ledger query for periodic audit:**
```sql
SELECT change_type, COUNT(*) FROM fabrication_ledger
  WHERE created_at > NOW() - INTERVAL '7 days' GROUP BY change_type;
```

### 18.3 — Total mode preservation

For the record: v8 patches did NOT modify total mode behavior in the resume
generator. The chain `skills/resume-tailor/SKILL.md` (full skill content, all
four modes) + `PIPELINE_OVERRIDE` (in `src/resume-generator/prompt.ts`, autonomous
execution rules + fabrication-permitted clause) + hardcoded
`{ role: "system", content: TOTAL_MODE_PROMPT }` in
`src/resume-generator/generator.ts` is unchanged. Every resume call is total mode.

The `tech_swaps` mechanism added in §18.2 is a Mode B augmentation layered on top
of total mode, not a replacement. Generator still fabricates per skill rules
when no adjacent experience exists for a missing JD requirement.

### 18.5 — Round-2 quality audit and hard guards

Round-2 added two ideas that should remain paired:

1. audit the generated artifacts against the canonical resume, JD, and paired
   artifact
2. convert recurring prompt misses into deterministic guards where possible

`scripts/audit-artifacts.ts` is the historical scanner. It reads the four
requested run folders from 2026-05-26/27, does not mutate them, and writes:

- `output/audits/round2_artifact_quality_baseline.json`
- `output/audits/round2_artifact_quality_baseline.md`

The audit scores each job with:

- `better_than_original`
- concrete `why_better`
- `risk_issues`
- `fix_category`

It checks JD skill coverage, SKILLS equality, dropped canonical evidence,
generated claim volume, role-attribution risk, cover/resume stack agreement,
banned bridge phrases, dash forms, truncation, unsafe visa wording, and cover
length.

Important baseline counts from the 53-resume / 49-cover historical corpus:

- 48 partial improvements over the original resume
- 5 no-clear-improvement cases
- 17 style-issue jobs after expanding the banned phrase family
- 42 dash-issue jobs
- 3 truncated covers
- 51 SKILLS-drift jobs
- 1 employer-stack mismatch
- 38 fabricated-attribution overruns

Code responses to those findings:

- prompt-level punctuation rule in resume + cover generators
- `stripDashes()` runtime sanitizer
- prompt-level resume and cover STYLE GUARD
- `hasBannedStylePhrase()` runtime style gate
- cover-letter retry/fail on truncation
- dynamic cover-letter narration from active `tech_swaps` and fabricated claims
- hard SKILLS block replacement from canonical resume
- `resume_attribution_overrun` soft-gate flag when fabricated role attribution
  count exceeds 3

The live MAX=10 validation run on 2026-05-27 confirmed the config and migration
path were loaded: extractor and judge both used `deepseek/deepseek-v4-flash`,
migration 008 applied, 7/7 eligible jobs extracted, no judge failures occurred,
and 5 resume/cover pairs were generated. That run exposed the final two hard
guards (style lint expansion and SKILLS replacement), which were added
immediately afterward.

### 18.6 — Failure visibility and manual recovery

v11 closed the loop on a frustrating artifact-debugging class: runs where the
UI showed "skipped" or "missing" even though generation had actually failed.

Changes:

- `src/applications/combined-meta.ts` preserves failed resume and failed cover
  metadata in the combined `meta.json`, including model, prompt SHA, token
  counts, word count, compile status, flags, and `error`.
- `src/cover-letter/saver.ts` stores `clResult.error` in cover metadata.
- `src/resume-generator/generator.ts` extracts the LaTeX document from wrapped
  model output before strict validation, improving compatibility with
  `deepseek/deepseek-v4-pro`-style responses.
- `scripts/run-pipeline.ts` writes direct-run stdout/stderr logs to
  `output/logs/runs/{YYYY-MM-DD}/log_{timestamp}_{run-folder}_{source}_{runid}.log`.
- `src/artifacts/manual-generate.ts` writes compact manual-generation logs to
  `output/logs/runs/{YYYY-MM-DD}/manual_{timestamp}_{run-folder}_{jobid}.log`.
- `src/storage/persist.ts::jobHasCompleteArtifacts()` lets manual generation
  distinguish complete artifacts from partial/failed artifact history.
- `ui/src/components/JobCard.tsx` passes `force=true` only when the user is
  regenerating existing PDFs; failed/missing artifacts can be repaired without
  being blocked by stale rows.

Observed trigger: the `deepseek/deepseek-v4-pro` run
`2026-05-27T15-32-09_2aec1edc` produced 7 cover letters and 0 resumes. The next
Flash run produced 5 resumes and 6 cover letters. The likely Pro failure was
valid LaTeX wrapped in extra model prose, combined with old validation that
required the response to start exactly at `\documentclass`.

### 18.7 — v13 quality, correctness, and reliability update (2026-06-02)

Twenty issues identified through 84-job corpus analysis, log analysis, and code audit.
Full issue list and root causes in `SESSION-HANDOFF.md` (2026-06-02).

**Judge prompt (Issues 3, 4, 6):**
- `frame_as` expanded from 1-sentence to 2–3 sentence structured brief (role context +
  adjacent evidence + execution angle). Root cause of both banned-phrase contamination in
  `frame_as` and excessive `acknowledge` output (70 acknowledges vs 5 fabricates / 84 jobs).
- Output format example updated to multi-sentence brief — LLMs anchor on examples.
- Banned phrase list added to `frame_as` guidance.
- Fabricate plausibility test rewritten from detectability to fit test.

**Resume generator (Issues 1, 2, 11):**
- `VOICE AND POSITIONING` section added to `TOTAL_MODE_PROMPT`.
- `replaceSkillsSection` now swap-aware — accepts `techSwaps`, applies to canonical before
  restoring. Resolves active conflict where prompt instructed swaps in SKILLS but
  `replaceSkillsSection` immediately overwrote them.
- `boldMetrics` nested-brace regex fixed (Class A compile failures).
- Prompt forbids nested `\textbf{}`.
- Saver deletes stale PDF before compile (Class B: valid PDFs from nonstopmode runs).
- Premium stream abort retries once (5s) before fallback.

**Cover letter (Issues 9, 15):**
- Experience block now receives scoped tech swaps before passing to generator.
- Transient API errors (empty content, 5xx, terminated) use separate retry counter.

**Shared (Issues 7, 8, 10):**
- `src/shared/utils.ts` new: `escapeRegexStr`, `applyTechSwaps`, `applyScopedTechSwaps`.
- `hasOverlap` in `audit.ts` replaced with Jaccard content-word matching (0.45 threshold).
- `skillsSectionEqual` in `audit-artifacts.ts` uses `normalizeBlock` + swap-aware comparison.
- `style-lint.ts` gained 3 new unambiguous banned patterns.

**Risk map (Issues 5, 13, 14, 19, 20):**
- 28 new `direct_equivalent` entries for 2025–2026 JD vocabulary. Total DE: 200.
- 13 Phase-8 entries restored to additive structure (adjacent + direct_equivalent coexist).
- 148 `requires_human_review` entries set to `false` (pure naming variants, full names,
  obvious synonyms). 35 kept `true`. Reduces yellow badge noise dramatically.
- Migration `011_ledger_truth_distance_numeric.sql`: `truth_distance_score` INTEGER → NUMERIC.

**Metrics at v13 baseline (84-job corpus, pre-v13):**
- `tech_swaps` fired: 4/84 jobs (5%)
- `fabricate` directives: 5 total
- `acknowledge` directives: 70 total
- `resume_attribution_overrun` rate: 36% (30/84)
- `pdf_compile_failed`: 4
- `frame_as` banned phrase hits: 17
- Expected to improve substantially on first v13 batch run.
