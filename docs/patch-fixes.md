# Patch Tailoring — Fix Instructions (2026-06-03)

Agent instructions for fixing all confirmed bugs in `patch-bugs.md`.
Apply in the order listed — fixes 1–3 have dependencies that affect everything downstream.

---

## FIX-01 — Judge prompt: wrong `target_role` examples

**File:** `src/judge/prompt.ts:254-258`

**Replace:**
```
target_role must EXACTLY match an employer header from the candidate's experience.
Valid examples: "Hitachi Vantara", "Hitachi Vantara / Nokia", "AquilaEdge LLC",
"PHIA Group", "Persistent Systems".
- target_role must be a string present in the work-history block: an employer header
  (e.g., "Hitachi Vantara") or a project tag (e.g., "Nokia", "PHIA"). Never invent a role name.
```

**With:**
```
target_role must EXACTLY match one of these block headers from the candidate's experience:
"Hitachi Vantara" (employer-level; use only for cross-project or promotion claims),
"Project: Nokia" (Nokia CPQ bullets), "Project: PHIA" (PHIA Group / PATS bullets),
"Project: Nissan" (Nissan telemetry bullets), "AquilaEdge LLC", "Persistent Systems".
NEVER emit composite forms like "Hitachi Vantara / Nokia" or bare project names like
"Nokia" or "PHIA Group". Those strings do not exist as resume blocks and will be
silently dropped. If targeting Nokia-specific bullets, target_role = "Project: Nokia".
If targeting PHIA bullets, target_role = "Project: PHIA".
If targeting Nissan bullets, target_role = "Project: Nissan".
```

**Also:** Find where `rolesList` is built (search callers of `buildSystemPrompt` in `judge/judge.ts`). Verify the work-history section headers in that string include the project block names as visible headings (`Project: Nokia`, `Project: PHIA`, `Project: Nissan`) so the judge sees the exact strings to use in `target_role`.

---

## FIX-02 — `sameRoleish` substring guard

**File:** `src/resume-generator/patch/generator.ts:239-243`

**Replace the function body:**
```typescript
function sameRoleish(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  return na === nb ||
    (na.length >= 5 && nb.length >= 5 && (na.includes(nb) || nb.includes(na)));
}
```

**Also:** Check `src/resume-generator/patch/parser.ts` lines 85–89. If it has its own `sameRoleish`/`normalize` or uses `findRoleBlock` with the same logic, apply the identical length guard there.

---

## FIX-03 — Tech swaps not applied to EXPERIENCE bullets

**File:** `src/resume-generator/index.ts:110-112`

**Replace:**
```typescript
let tex = boldMetrics(
  replaceSkillsSection(stripDashes(gen.tex), bundle.canonical_resume_tex, input.tech_swaps),
);
```

**With:**
```typescript
const strippedTex = stripDashes(gen.tex);
const swappedTex = (input.tech_swaps?.length ?? 0) > 0
  ? applyTechSwaps(strippedTex, input.tech_swaps!)
  : strippedTex;
let tex = boldMetrics(
  replaceSkillsSection(swappedTex, bundle.canonical_resume_tex, input.tech_swaps),
);
```

Verify `applyTechSwaps` is imported at top of `index.ts`. If not, add import from `@/shared/utils` or wherever it is defined.

**Why this works:** `applyTechSwaps` runs on full tex first (SKILLS + EXPERIENCE). Then `replaceSkillsSection` replaces only the SKILLS slice with canonical+swapped. Net: EXPERIENCE gets swapped, SKILLS gets canonical+swapped. No double-swap in SKILLS.

---

## FIX-04 + FIX-05 — Multi-op index drift + same-anchor reversal

**File:** `src/resume-generator/patch/apply.ts:29-55`

Both bugs fixed by sorting ops before processing.

**Replace `for (const op of ops)` at line 31 with:**
```typescript
// Sort: rewrites first (no index shift), then inserts bottom-to-top (prevents upward drift).
// Bottom-to-top also preserves insertion order for same-anchor ops.
const sortedOps = [...ops].sort((a, b) => {
  const aRank = a.type === "rewrite" ? 0 : 1;
  const bRank = b.type === "rewrite" ? 0 : 1;
  if (aRank !== bRank) return aRank - bRank;
  const aPos = a.type === "insert_after" ? (a.after_item ?? 0) : 0;
  const bPos = b.type === "insert_after" ? (b.after_item ?? 0) : 0;
  return bPos - aPos; // descending — bottom of block first
});
for (const op of sortedOps) {
```

---

## FIX-06 — Coverage keyword filter drops short tech terms

**File:** `src/resume-generator/patch/coverage.ts`

**Add this constant before the `keywords` function:**
```typescript
/** Short but meaningful tech abbreviations that must survive the length filter. */
const TECH_SHORT_TERMS = new Set([
  "aws", "sql", "api", "k8s", "etl", "iam", "sso", "pci", "sox",
  "go", "ml", "ci", "cd", "nlp", "llm", "mq", "gcp", "rds",
]);
```

**Change line 84:**
```typescript
// Before:
.filter(s => s.length >= 4 && !STOPWORDS.has(s)),
// After:
.filter(s => (s.length >= 4 || TECH_SHORT_TERMS.has(s)) && !STOPWORDS.has(s)),
```

---

## FIX-07 — Coverage fail with 0 ops ships `status: "ok"`

**File:** `src/resume-generator/patch/orchestrator.ts`

Inside the `if (coverage.missed.length === 0 || attempt === 1)` block (around line 78), add this check **before** the existing return statement:

```typescript
// 0 ops + missed coverage = nothing was applied at all; return error so caller blocks the artifact
if (allOps.length === 0 && coverage.missed.length > 0) {
  return {
    status: "error",
    tex: null,
    model,
    prompt_sha: PATCH_PROMPT_SHA,
    word_count: 0,
    tokens: { input: totalInput, output: totalOutput },
    generated_at,
    error: `patch produced no valid ops; missed: ${coverage.missed.join("; ")}`,
  };
}
```

Leave the existing path (ops exist but some coverage missed) as `status: "ok"` + `resume_patch_coverage_failed` warning — that is acceptable behavior.

---

## FIX-08 — `filterValidOps` silent drops

**File:** `src/resume-generator/patch/generator.ts:206-214`

**Replace the function body with a logging version:**
```typescript
function filterValidOps(ops: PatchOp[], roleBlocks: RoleBlock[]): PatchOp[] {
  const available = roleBlocks.map(b => b.role).join(", ");
  return ops.filter(op => {
    const block = roleBlocks.find(b => sameRoleish(b.role, op.role));
    if (!block) {
      console.warn(`[patch] filterValidOps: dropped — role "${op.role}" not in [${available}]`);
      return false;
    }
    if (op.type === "rewrite" && !(op.item >= 1 && op.item <= block.items.length)) {
      console.warn(`[patch] filterValidOps: dropped rewrite — item ${op.item} OOB in "${op.role}" (${block.items.length} items)`);
      return false;
    }
    if (op.type === "insert_after" && !(op.after_item >= 1 && op.after_item <= block.items.length)) {
      console.warn(`[patch] filterValidOps: dropped insert_after — after_item ${op.after_item} OOB in "${op.role}" (${block.items.length} items)`);
      return false;
    }
    return true;
  });
}
```

---

## FIX-09 — Short cover letter ships without retry

**File:** `src/cover-letter/generator.ts`

Find the retry condition (where `truncated` and `bannedStyle` are evaluated). Change to also trigger retry when `wordCount < 350`:

```typescript
// Before (approximate):
const shouldRetry = truncated || bannedStyle;
// After:
const shouldRetry = truncated || bannedStyle || wordCount < 350;
```

Only applies on attempt 0. Final attempt ships with `cover_letter_length_off` flag regardless.

---

## FIX-10 — Cover letter retry tokens not summed

**File:** `src/cover-letter/generator.ts`

At the top of the generation function declare running totals:
```typescript
let totalInputTokens = 0;
let totalOutputTokens = 0;
```

After each LLM call (success or failure), accumulate:
```typescript
totalInputTokens += result.input_tokens ?? 0;
totalOutputTokens += result.output_tokens ?? 0;
```

Return `totalInputTokens`/`totalOutputTokens` in the final result instead of last-attempt values.

---

## FIX-11 — Cache key excludes tailoring hint fields

**File:** `src/artifacts/resume-cache.ts:46-58`

Find the signature hash construction. Replace the payload being hashed with one that includes all `tailoring_hints` fields:

```typescript
const hashPayload = {
  gap_directives: directives,         // already included
  tech_swaps: techSwaps,              // already included
  emphasize_roles: tailoringHints?.emphasize_roles ?? [],
  emphasize_skills: tailoringHints?.emphasize_skills ?? [],
  downplay_skills: tailoringHints?.downplay_skills ?? [],
  domain_reframe_angle: tailoringHints?.domain_reframe_angle ?? null,
};
// hash this full object instead of partial
```

---

## FIX-12 — Cache hit doesn't copy TeX into new run folder

**File:** `scripts/run-pipeline.ts:941-958`

After cache hit returns `resumeOutcome`, add a copy step before continuing:

```typescript
// Copy cached tex/pdf into new job folder so this run's folder is self-contained
if (resumeOutcome.tex_path) {
  const newTexPath = path.join(jobFolderAbs, "resume.tex");
  try {
    await fs.promises.copyFile(resumeOutcome.tex_path, newTexPath);
    resumeOutcome = { ...resumeOutcome, tex_path: newTexPath };
    if (resumeOutcome.pdf_path) {
      const newPdfPath = path.join(jobFolderAbs, "resume.pdf");
      await fs.promises.copyFile(resumeOutcome.pdf_path, newPdfPath);
      resumeOutcome = { ...resumeOutcome, pdf_path: newPdfPath };
    }
  } catch (e) {
    console.warn(`[cache] failed to copy cached tex to new folder: ${String(e).slice(0, 200)}`);
  }
}
```

---

## FIX-13 — Judge and extractor tokens untracked

**Files:** judge LLM client, extractor LLM client, `src/applications/combined-meta.ts`, `scripts/run-pipeline.ts`

**Step 1 — Judge client:** Find where `complete()` is called for the judge. Capture `usage`:
```typescript
// Add to JudgeResult type:
input_tokens?: number;
output_tokens?: number;
// In judge client after LLM call:
return { ...judgeResult, input_tokens: response.usage?.prompt_tokens, output_tokens: response.usage?.completion_tokens };
```

**Step 2 — Extractor client:** Same pattern — capture and return usage from the extractor's `complete()` call.

**Step 3 — `combined-meta.ts`:** Write judge and extractor token fields into the meta output:
```typescript
judge: {
  ...existingJudgeFields,
  input_tokens: judgeResult.input_tokens ?? null,
  output_tokens: judgeResult.output_tokens ?? null,
},
extractor: {
  ...existingExtractorFields,
  input_tokens: extractorResult.input_tokens ?? null,
  output_tokens: extractorResult.output_tokens ?? null,
},
```

**Step 4 — `run-pipeline.ts` rollup:** Add judge + extractor tokens to the token log line that currently shows only resume + cover totals.

---

## Implementation order

| Step | Fix | Why this order |
|---|---|---|
| 1 | FIX-01 (judge prompt) | Gate — wrong target_role drives all downstream bugs |
| 2 | FIX-02 (sameRoleish) | Role matching — needed before testing anything |
| 3 | FIX-08 (logging) | Visibility — see what's happening before verifying |
| 4 | FIX-03 (tech swaps) | Independent — safe to apply any time |
| 5 | FIX-04+05 (op sort) | apply.ts — independent |
| 6 | FIX-06 (coverage filter) | coverage.ts — independent |
| 7 | FIX-07 (coverage fail status) | orchestrator — depends on FIX-06 being correct |
| 8 | FIX-09+10 (CL) | Independent of resume pipeline |
| 9 | FIX-11+12 (cache) | Independent — no output impact |
| 10 | FIX-13 (token tracking) | Last — no output impact, observability only |

After FIX-01 through FIX-03 are in: re-run one batch and verify:
- `patch_ops[].role` matches `Project: Nokia` / `Project: PHIA` / `Project: Nissan` (not `Hitachi Vantara`)
- New bullets appear in the correct project `itemize` blocks
- Tech swap terms absent from EXPERIENCE bullets in canonical are present in patched EXPERIENCE
