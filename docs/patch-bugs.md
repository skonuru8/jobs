# Patch Tailoring — Confirmed Bugs (2026-06-03)

Discovered via audit of run `2026-06-03T19-04-48_cf6fa34a` (38 apps, ~1.42M tokens, minimal resume changes).
All findings verified with TeX diffs, source code, and meta.json evidence.

---

## Root Cause Summary

The patch system is structurally operational but produces wrong output because:
1. The judge emits composite `target_role` labels (`"Hitachi Vantara / Nokia"`) that the TeX parser never produces
2. `sameRoleish` fuzzy-matches the composite to the parent employer block instead of the project block
3. Patches land in the wrong section; coverage falsely passes; resumes look unchanged

---

## BUG-01 — Judge emits composite `target_role` strings that don't match TeX blocks

**Severity:** Critical — root cause of wrong-section patches

**File:** `src/judge/prompt.ts:254-258`

**Evidence:**
- Prompt explicitly lists `"Hitachi Vantara / Nokia"` and `"PHIA Group"` as valid `target_role` examples
- TeX parser (`parser.ts`) only produces: `Hitachi Vantara`, `Project: Nokia`, `Project: PHIA`, `Project: Nissan`, `AquilaEdge LLC`, `Persistent Systems`
- Run `cf6fa34a`: ascending, technipros-mclean, avis — all had ops targeting `Project: Nokia`/`Project: Nissan` but `patch_ops[].role = "Hitachi Vantara"` in every case
- Technipros-mclean: Nokia K8s bullet was *duplicated* under Hitachi employer instead of rewriting the Nokia project block

**What happens:**
`sameRoleish("Hitachi Vantara", "Hitachi Vantara / Nokia")` → `true` (substring) → ops land in the 1-bullet Hitachi employer promo section, not the Nokia project itemize.

---

## BUG-02 — `sameRoleish` substring match fires on short strings

**Severity:** Critical — causes wrong-block selection and false positives

**File:** `src/resume-generator/patch/generator.ts:239-243`

**Evidence (code):**
```typescript
function sameRoleish(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  return na === nb || na.includes(nb) || nb.includes(na); // no length guard
}
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
```

- `normalize("C++")` → `"c"` → length 1, matches any role containing "c"
- `normalize("it")` → `"it"` → substring of `"credit suisse"`, `"persistent"` etc.
- `normalize("PHIA Group")` → `"phia group"` — does NOT contain `"project phia"` → drops to null → op silently filtered

---

## BUG-03 — Tech swaps never applied to EXPERIENCE bullets in patch mode

**Severity:** Critical — visible output defect (old tech name stays in bullets)

**File:** `src/resume-generator/index.ts:110-112`

**Evidence (real data, Seven Seven Softwares, run `cf6fa34a`):**
- Tech swap specified: `Azure Service Bus → Kafka`
- SKILLS (L62): `Kafka` appears ✓ (swap ran)
- EXPERIENCE (L93, L101): `Azure Service Bus` still present ✗ (swap never ran)

**Code cause:**
```typescript
// applyTechSwaps called only inside replaceSkillsSection
// replaceSkillsSection regex: \section*{SKILLS} to \section*{EXPERIENCE}
// EXPERIENCE section never touched
let tex = boldMetrics(
  replaceSkillsSection(stripDashes(gen.tex), bundle.canonical_resume_tex, input.tech_swaps),
);
```

---

## BUG-04 — Multi-op index drift in apply.ts

**Severity:** Critical — subsequent ops in same role target wrong bullet

**File:** `src/resume-generator/patch/apply.ts:29-53`

**What happens:**
- `filterValidOps` validates indices against frozen canonical block (e.g., item 2 = bullet 2)
- `applyPatchOps` re-parses after each op (by design, for offset accuracy)
- `insert_after item:1` inserts a new bullet → block now has N+1 items
- Next op `rewrite item:2` was validated against original item 2, but now hits item 3 (shifted up)

---

## BUG-05 — Multiple `insert_after` same anchor inserts in reverse order

**Severity:** High — bullets appear in wrong order vs planner intent

**File:** `src/resume-generator/patch/apply.ts:50-52`

Each `insert_after item:1` inserts at the same byte offset. Later ops in the loop insert before earlier ops at that position → order is inverted.

---

## BUG-06 — Coverage keyword filter drops important 3-char tech terms

**Severity:** High — `aws`, `sql`, `api`, `k8s`, `etl`, `iam`, `ci`, `cd` all silently filtered

**File:** `src/resume-generator/patch/coverage.ts:84`

```typescript
.filter(s => s.length >= 4 && !STOPWORDS.has(s))
// "sql" = length 3 → filtered
// "aws" = length 3 → filtered
// "api" = length 3 → filtered
```

**Confirmed:** TechniPros Dallas — jd_requirement `"sql (required)"`, `sql` filtered; caused additional friction (though primary failure was BUG-02 / `target_role` mismatch).

---

## BUG-07 — Coverage fail with 0 ops ships `status: "ok"`

**Severity:** High — bad resume silently passes as successful

**File:** `src/resume-generator/patch/orchestrator.ts:78-100`

When both retry attempts produce 0 valid ops and coverage still fails, the orchestrator returns `status: "ok"` with a `resume_patch_coverage_failed` warning. The resume ships unchanged from canonical.

---

## BUG-08 — `filterValidOps` drops ops with no logging

**Severity:** Medium — invisible data loss, hard to debug

**File:** `src/resume-generator/patch/generator.ts:206-214`

No `console.warn` when ops are dropped. A run that burns 1,200 tokens on an LLM call but produces 0 valid ops leaves no trace in logs or meta.

---

## BUG-09 — Short cover letter ships without retry

**Severity:** Medium — low-quality CL artifact

**File:** `src/cover-letter/generator.ts`

CL with `wordCount < 350` that ends with punctuation (not truncated) and has no banned phrase skips the retry condition. Ships with only a `cover_letter_length_off` flag.

---

## BUG-10 — Cover letter retry tokens not summed

**Severity:** Medium — token spend undercounted in meta.json

**File:** `src/cover-letter/generator.ts`

Meta records only last successful attempt's `input_tokens`/`output_tokens`. Prior retry attempts' token costs are silently dropped.

---

## BUG-11 — Cache key excludes tailoring hint fields

**Severity:** Medium — stale resume reused when judge changes emphasis

**File:** `src/artifacts/resume-cache.ts:46-58`

Cache key hashes only `gap_directives` + `tech_swaps`. Changes to `emphasize_roles`, `emphasize_skills`, `downplay_skills`, `domain_reframe_angle` produce false cache hits → prior resume reused unchanged.

---

## BUG-12 — Cache hit doesn't copy TeX into new run folder

**Severity:** Medium — fragmented artifact paths across runs

**File:** `scripts/run-pipeline.ts:941-958`

On cache hit, `tex_path` and `pdf_path` point to the prior run's folder. The new run's job folder has no local copy of the files.

---

## BUG-13 — Judge and extractor tokens completely untracked

**Severity:** Medium — 78% of token spend invisible

**Files:** `src/judge/judge.ts`, extractor client

Run `cf6fa34a`: meta.json recorded 307,660 tokens (resume + CL only). Remaining ~1.11M came from judge (~750–830k, 83 calls) and extractor (~350–470k, 93 calls) — neither captured in meta.json or results.jsonl.

---

## Token spend breakdown (run `cf6fa34a`, 38 apps / 100 jobs)

| Stage | Tokens (est.) | Tracked in meta.json |
|---|---|---|
| Judge (83 calls × ~9k tok) | ~750–830k | **No** |
| Extractor (93 calls × ~4k tok) | ~350–470k | **No** |
| Cover letter (34 calls) | ~268k | Yes |
| Resume patch (23 LLM calls) | ~40k | Yes |
| **Total** | **~1.42M** | **307k tracked (22%)** |

Resume patch = 3% of total spend. Patch token savings are real but irrelevant to the overall bill.
