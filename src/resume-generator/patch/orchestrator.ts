/**
 * orchestrator.ts — End-to-end patch tailoring flow for resume generation.
 *
 * Coordinates patch planning, deterministic application, coverage retry, and
 * final warning synthesis so patch mode can return resume artifacts shaped like
 * full generation mode without regenerating whole document.
 *
 * Called by: resume-generator/generator.ts
 * Writes to: nothing
 * Side effects: up to two LLM calls, text lint checks, LaTeX structure validation
 */

import { findBannedStylePhrases, hasBannedStylePhrase, stripBannedStyleClauses } from "@/shared/style-lint";

import { countWordsTex, latexStructureOk } from "../generator";
import type { ResumeGenConfig, ResumeGenInput, ResumeGenResult } from "../types";
import { applyPatchOps } from "./apply";
import { verifyPatchCoverage } from "./coverage";
import { runDiffLint } from "./diff-lint";
import { activeGapDirectives, generatePatchOps, PATCH_PROMPT_SHA, PATCH_TOTAL_PROMPT_SHA } from "./generator";
import type { GapDirective } from "@/judge/types";
import { extractRoleBlocks, findRoleBlock } from "./parser";
import type { RoleBlock } from "./types";

/**
 * Generates tailored resume TeX by applying LLM-planned patch ops to canonical source.
 *
 * Flow makes at most two planner attempts. First missed-coverage result feeds a
 * retry hint back into planner, then final output is linted and annotated with
 * warnings instead of hard-failing for recoverable issues like partial coverage.
 *
 * @param input - Resume generation inputs including canonical TeX and judge output.
 * @param config - Resume generation config supplying model and token limits.
 * @returns Resume generation result shaped like standard generator output.
 */
export async function generatePatchedResumeTex(
  input: ResumeGenInput,
  config: ResumeGenConfig,
): Promise<ResumeGenResult> {
  const generated_at = new Date().toISOString();
  const patchSha = config.mode === "patch_total" ? PATCH_TOTAL_PROMPT_SHA : PATCH_PROMPT_SHA;
  const roleBlocks = extractRoleBlocks(input.canonical_resume_tex);
  const directives = activeGapDirectives(input.gap_directives ?? input.judge_json.gap_directives ?? []);
  // Extract emphSkills once for use in post-generation validation (validateBoldTermSources).
  const emphSkills = (input.judge_json.tailoring_hints?.emphasize_skills ?? []).slice(0, 5);
  // NOT FIXED — cross-job bullet diversity: the same canonical bullets appear across many
  // resumes because (1) each job is processed independently with no shared state, and (2)
  // the same bullets are the only eligible ones after the 4-step eligibility check. A real
  // fix needs cross-run state (a usage counter per canonical item) which does not exist here.
  let allOps = [];
  let totalInput = 0;
  let totalOutput = 0;
  let model = config.model;
  let retryCount = 0;
  let totalDroppedUnknownRole = 0;
  let modelOverride: string | undefined;

  // Single attempt only. No coverage-driven re-plan. A thrown LLM error gets one
  // fallback-model retry; coverage misses / zero-ops are reported as flags, not retried.
  let generated;
  try {
    generated = await generatePatchOps(input, config, roleBlocks, undefined, modelOverride);
  } catch (e) {
    if (config.fallback_model && modelOverride === undefined) {
      retryCount += 1;
      modelOverride = config.fallback_model;
      try {
        generated = await generatePatchOps(input, config, roleBlocks, undefined, modelOverride);
      } catch (e2) {
        return {
          status: "error",
          tex: null,
          model,
          prompt_sha: PATCH_PROMPT_SHA,
          word_count: 0,
          tokens: { input: totalInput, output: totalOutput },
          generated_at,
          error: `patch op generation failed: ${String(e2).slice(0, 500)}`,
        };
      }
    } else {
      return {
        status: "error",
        tex: null,
        model,
        prompt_sha: PATCH_PROMPT_SHA,
        word_count: 0,
        tokens: { input: totalInput, output: totalOutput },
        generated_at,
        error: `patch op generation failed: ${String(e).slice(0, 500)}`,
      };
    }
  }

  allOps = enforceOpCaps(
    dedupRewriteOps(
      dropSubstancelessInjections(
        validateBoldTermSources(
          dropNoopRewrites(
            stripBannedPhraseOps(sanitizePatchOps(generated.ops)),
            roleBlocks,
          ),
          roleBlocks, directives, emphSkills,
        ),
        roleBlocks, directives,
      ),
    ),
    directives,
    config,
  );
  totalInput += generated.tokens.input;
  totalOutput += generated.tokens.output;
  model = generated.model;
  totalDroppedUnknownRole += generated.ops_dropped_unknown_role;

  const tex = applyPatchOps(input.canonical_resume_tex, allOps);
  const coverage = verifyPatchCoverage(tex, directives, allOps);
  const allDirectives = input.gap_directives ?? input.judge_json.gap_directives ?? [];
  const lintResult = runDiffLint(tex, allOps, allDirectives, config.word_count_min, config.word_count_max);

  const acknowledgedGaps = allDirectives
    .filter(d => d.handling === "acknowledge")
    .map(d => d.jd_requirement);

  if (allOps.length === 0 && coverage.missed.length > 0) {
    return {
      status: "error",
      tex: null,
      model,
      prompt_sha: patchSha,
      word_count: 0,
      tokens: { input: totalInput, output: totalOutput },
      generated_at,
      error: `patch produced no valid ops; missed: ${coverage.missed.join("; ")}`,
    };
  }

  const hadActiveWork = directives.length > 0 || (input.judge_json.tailoring_hints?.emphasize_roles ?? []).length > 0;

  const warnings: string[] = [];
  if (coverage.missed.length > 0) warnings.push("resume_patch_coverage_failed");
  if (allOps.length === 0 && hadActiveWork) warnings.push("resume_patch_no_ops");
  if (findBannedStylePhrases(tex).length > 0) warnings.push("banned_phrase_in_output");
  if (!latexStructureOk(tex)) warnings.push("tex_malformed");
  for (const flag of lintResult.flags) warnings.push(flag);
  const opsWarn = config.patch_ops_warn_threshold ?? 12;
  if (allOps.length > opsWarn) warnings.push("resume_patch_ops_explosion");

  return {
    status: "ok",
    tex,
    model,
    prompt_sha: PATCH_PROMPT_SHA,
    word_count: countWordsTex(tex),
    tokens: { input: totalInput, output: totalOutput },
    generated_at,
    warnings,
    patch: {
      ops: allOps,
      coverage,
      retry_count: retryCount,
      failed_directives: coverage.missed,
      prompt_sha: patchSha,
      ops_dropped_unknown_role: totalDroppedUnknownRole,
      acknowledged_gaps: acknowledgedGaps.length > 0 ? acknowledgedGaps : undefined,
    },
  } as ResumeGenResult;
}

/**
 * Strips banned style phrases from patch op bullet text before applying to canonical TeX.
 *
 * LLMs sometimes copy banned hedging phrases from frame_as guidance into bullets verbatim.
 * This sanitizer runs deterministically after generation and before application as a
 * defense-in-depth layer that operates regardless of model compliance with the prompt.
 *
 * Drops ops whose bullet content becomes too short after stripping (< 40 chars of content),
 * since that indicates the banned phrase was load-bearing and the bullet cannot be salvaged.
 *
 * @param ops - Raw patch ops from planner, potentially containing banned phrases.
 * @returns Sanitized ops with banned clauses stripped; unsalvageable ops removed.
 */
function sanitizePatchOps(ops: import("./types").PatchOp[]): import("./types").PatchOp[] {
  return ops
    .map(op => {
      const field = op.type === "rewrite" ? "new_item" : "item";
      const raw = (op as Record<string, unknown>)[field] as string;
      if (!hasBannedStylePhrase(raw)) return op;

      const cleaned = stripBannedStyleClauses(raw);
      const contentLen = cleaned.replace(/\\item\s*/, "").replace(/\\[a-zA-Z]+\{[^}]*\}/g, "x").replace(/[{}\\]/g, "").trim().length;
      if (hasBannedStylePhrase(cleaned) || contentLen < 40) {
        console.warn(`[patch] sanitizePatchOps: dropped op — residual banned phrase or empty content after strip in role "${op.role}"`);
        return null;
      }
      console.log(`[patch] sanitizePatchOps: stripped banned phrase from bullet in role "${op.role}"`);
      return { ...op, [field]: cleaned };
    })
    .filter(Boolean) as import("./types").PatchOp[];
}

function normalizeLatex(s: string): string {
  return s
    .replace(/\\textbf\{([^}]+)\}/g, '$1')
    .replace(/\\[a-zA-Z]+\{([^}]*)\}/g, '$1')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractBoldTerms(s: string): string[] {
  return [...s.matchAll(/\\textbf\{([^}]+)\}/g)].map(m => m[1].trim()).filter(t => t.length > 0);
}

/**
 * Tests whether a term appears in text. A purely alphanumeric single-word term
 * uses word-boundary matching so "go" does not match "going". Multi-word terms
 * and terms containing non-word characters (C++, C#, .NET, Node.js) fall back to
 * substring match, because JS `\b` does not anchor next to +/#/./- and would
 * otherwise produce false "not found" results that drop legitimate ops.
 */
function termAppearsInText(term: string, text: string): boolean {
  const termLower = term.toLowerCase();
  const textLower = text.toLowerCase();
  // Substring match for multi-word terms or terms with non-word characters.
  if (termLower.includes(" ") || /[^a-z0-9]/.test(termLower)) {
    return textLower.includes(termLower);
  }
  return new RegExp(`\\b${termLower}\\b`).test(textLower);
}

/**
 * Drops rewrite ops that introduce invented \textbf{...} tech terms with no source.
 *
 * The planner sometimes fabricates technologies (e.g. Go/GraphQL/Kafka at a role
 * that never used them) and wraps them in \textbf to look like real evidence. For
 * every rewrite, any bold term that is NEW (not already bolded in the original
 * bullet) must trace back to one of: (a) any canonical text for that role, (b) the
 * directive's frame_as for that role, or (c) the emphasize_skills list. A new bold
 * term grounded in none of those sources was invented, so the op is dropped.
 *
 * Insert ops are skipped — they are brand-new bullets covered by the prompt's
 * no-invention rules and have no original bullet to diff against.
 *
 * @param ops - Ops after dropNoopRewrites.
 * @param roleBlocks - Parsed canonical role blocks used to resolve role text.
 * @param directives - Active gap directives supplying frame_as source text per role.
 * @param emphSkills - Judge-provided emphasis skills allowed as bold-term sources.
 * @returns Ops with invented-bold-term rewrites removed.
 */
function validateBoldTermSources(
  ops: import("./types").PatchOp[],
  roleBlocks: RoleBlock[],
  directives: GapDirective[],
  emphSkills: string[],
): import("./types").PatchOp[] {
  return ops.filter(op => {
    if (op.type !== "rewrite") return true;
    const block = findRoleBlock(roleBlocks, op.role);
    const originalItem = block?.items.find(i => i.index === op.item);
    if (!originalItem) return true;

    const origBold = new Set(extractBoldTerms(originalItem.text).map(t => t.toLowerCase()));
    const newBold = extractBoldTerms(op.new_item).filter(t => !origBold.has(t.toLowerCase()));
    if (newBold.length === 0) return true;

    const roleCanonical = (block?.items ?? []).map(i => i.text).join(" ");
    const frameSources = directives
      .filter(d => d.target_role && d.target_role.toLowerCase().trim() === op.role.toLowerCase().trim())
      .map(d => d.frame_as ?? "")
      .join(" ");

    for (const term of newBold) {
      const grounded =
        termAppearsInText(term, roleCanonical) ||
        termAppearsInText(term, frameSources) ||
        emphSkills.some(s => termAppearsInText(term, s));
      if (!grounded) {
        console.warn(`[patch] validateBoldTermSources: dropped rewrite for role "${op.role}" item ${op.item} — invented bold term "${term}" not found in role bullets, frame_as, or emphasize_skills`);
        return false;
      }
    }
    return true;
  });
}

/**
 * Drops substanceless emphasis rewrites that only re-wrap existing words in \textbf.
 *
 * Keyword stuffing: the planner rewrites a bullet to bold a word already present
 * without adding any new mechanism or content. Only emphasis ops (rewrites NOT
 * targeting a directive role) are checked — directive ops legitimately reshape
 * bullets. A rewrite is dropped when it contributes fewer than 2 genuinely new
 * words (words in new_item but not the original, longer than 2 chars, formatting
 * stripped via normalizeLatex).
 *
 * @param ops - Ops after validateBoldTermSources.
 * @param roleBlocks - Parsed canonical role blocks used to resolve original bullets.
 * @param directives - Active gap directives used to classify directive vs emphasis ops.
 * @returns Ops with substanceless emphasis rewrites removed.
 */
function dropSubstancelessInjections(
  ops: import("./types").PatchOp[],
  roleBlocks: RoleBlock[],
  directives: GapDirective[],
): import("./types").PatchOp[] {
  const directiveRoles = new Set(
    directives
      .filter(d => d.handling === "fabricate" || d.handling === "reframe")
      .map(d => d.target_role)
      .filter(Boolean) as string[],
  );
  const isDirectiveOp = (op: import("./types").PatchOp) =>
    directiveRoles.size > 0 &&
    [...directiveRoles].some(r => r.toLowerCase().trim() === op.role.toLowerCase().trim());

  const wordBag = (s: string) =>
    new Set(normalizeLatex(s).toLowerCase().split(/\s+/).filter(w => w.length > 2));

  return ops.filter(op => {
    if (op.type !== "rewrite") return true;
    if (isDirectiveOp(op)) return true;
    const block = findRoleBlock(roleBlocks, op.role);
    const original = block?.items.find(i => i.index === op.item)?.text;
    if (original === undefined) return true;

    const origWords = wordBag(original);
    const newWords = [...wordBag(op.new_item)].filter(w => !origWords.has(w));
    if (newWords.length < 2) {
      console.warn(`[patch] dropSubstancelessInjections: dropped emphasis rewrite for role "${op.role}" item ${op.item} — only ${newWords.length} new word(s), pure bold-wrapping`);
      return false;
    }
    return true;
  });
}

/**
 * Drops rewrite ops that produce no meaningful change or actively degrade the resume.
 *
 * Two cases are removed:
 * - Content-identical rewrites: same text after stripping all LaTeX formatting (markup churn).
 * - De-bolding rewrites: rewrite loses one or more named tech terms that were wrapped in
 *   `\textbf{...}` in the original, making the bullet unambiguously worse.
 *
 * Uses term-level set diff for de-bold detection (not a raw wrapper count) to avoid false
 * positives when wrappers are legitimately merged or restructured.
 *
 * @param ops - Sanitized patch ops from the planner.
 * @param roleBlocks - Parsed canonical role blocks used to resolve original bullets.
 * @returns Ops with degrading or no-op rewrites removed.
 */
function dropNoopRewrites(
  ops: import("./types").PatchOp[],
  roleBlocks: RoleBlock[],
): import("./types").PatchOp[] {
  return ops.filter(op => {
    if (op.type !== "rewrite") return true;
    const block = findRoleBlock(roleBlocks, op.role);
    const original = block?.items.find(i => i.index === op.item)?.text;
    if (original === undefined) return true;

    if (normalizeLatex(op.new_item) === normalizeLatex(original)) {
      console.warn(`[patch] dropNoopRewrites: dropped no-op rewrite for role "${op.role}" item ${op.item} (content unchanged after strip)`);
      return false;
    }
    const origBoldTerms = extractBoldTerms(original).map(t => t.toLowerCase());
    const newBoldTerms = new Set(extractBoldTerms(op.new_item).map(t => t.toLowerCase()));
    const droppedTerms = origBoldTerms.filter(t => !newBoldTerms.has(t));
    if (droppedTerms.length > 0) {
      console.warn(`[patch] dropNoopRewrites: dropped de-bolding rewrite for role "${op.role}" item ${op.item} (lost bold terms: ${droppedTerms.join(", ")})`);
      return false;
    }
    return true;
  });
}

/**
 * Collapses duplicate rewrite ops that target the same (role, item) slot.
 *
 * When the planner emits two rewrites for the same bullet only the last one
 * can apply — the first is clobbered during patch application. Keeping both
 * inflates apparent coverage and wastes an op slot. This step retains the
 * last op per slot (later ops represent the planner's final intent) and warns
 * so the duplicate is visible in logs for model quality tracking.
 *
 * insert_after and insert_first ops are left untouched because multiple
 * inserts at the same position each add a distinct new bullet.
 *
 * @param ops - Filtered patch ops from dropNoopRewrites.
 * @returns Ops with duplicate rewrites collapsed to the last per (role, item).
 */
function dedupRewriteOps(ops: import("./types").PatchOp[]): import("./types").PatchOp[] {
  const lastRewrite = new Map<string, import("./types").PatchOp>();
  for (const op of ops) {
    if (op.type === "rewrite") {
      const key = `${op.role}::${op.item}`;
      if (lastRewrite.has(key)) {
        console.warn(`[patch] dedupRewriteOps: duplicate rewrite for role "${op.role}" item ${op.item} — keeping last`);
      }
      lastRewrite.set(key, op);
    }
  }
  return ops.filter(op => op.type !== "rewrite" || lastRewrite.get(`${op.role}::${op.item}`) === op);
}

/**
 * Strips banned-phrase clauses from every op's bullet text and drops ops that
 * become empty or degenerate after stripping.
 *
 * Applies `stripBannedStyleClauses` to the new_item of rewrite ops and the
 * item_text of insert ops. If the result is shorter than 30 chars (likely
 * stripped down to just "\item" + punctuation), the op is dropped entirely so
 * it cannot introduce a malformed or empty bullet into the resume.
 *
 * This is the code-level enforcement backstop for the prompt-level ban list.
 * The prompt tells the model not to emit these phrases; this function removes
 * them if the model emits them anyway, then drops the op if nothing useful
 * remains.
 *
 * @param ops - Raw ops from the planner before any other filtering.
 * @returns Ops with banned phrases stripped and degenerate ops removed.
 */
function stripBannedPhraseOps(ops: import("./types").PatchOp[]): import("./types").PatchOp[] {
  return ops.flatMap(op => {
    const field = op.type === "rewrite" ? "new_item"
      : op.type === "insert_after" || op.type === "insert_first" ? "item" as keyof typeof op
      : null;
    if (!field) return [op];

    const original = (op as Record<string, unknown>)[field] as string | undefined;
    if (!original) return [op];

    const stripped = stripBannedStyleClauses(original);
    if (stripped === original) return [op];

    // Minimum viable bullet after stripping: "\item " plus at least 20 chars of content
    const contentAfterItem = stripped.replace(/^\\item\s*/i, "").trim();
    if (contentAfterItem.length < 20) {
      console.warn(`[patch] stripBannedPhraseOps: dropped op for role "${op.role}" — nothing left after stripping banned phrases`);
      return [];
    }

    console.warn(`[patch] stripBannedPhraseOps: stripped banned phrase from role "${op.role}" ${field as string}`);
    return [{ ...op, [field]: stripped }];
  });
}

/**
 * Hard-enforces op count limits that the prompt alone cannot reliably maintain.
 *
 * Rules:
 * 1. Directive ops (fabricate/reframe targeting a specific role) are identified by
 *    checking whether the op's role matches any active directive's target_role.
 *    These are preserved first because they carry JD-coverage; if they alone exceed
 *    the total cap, later directive ops are dropped (deterministically).
 * 2. Emphasis ops (all remaining rewrites) are capped at 2 per role.
 * 3. Total ops are HARD-capped at MAX_TOTAL (8) regardless of directive count, to
 *    honor the prompt's "never more than 8" invariant and keep cost bounded.
 *    Directive slots are filled first, then emphasis fills whatever remains.
 *
 * Caps are enforced deterministically (preserve earlier ops in the list, drop later ones)
 * so the result is stable across identical inputs.
 *
 * @param ops - Ops after dedup and noop-drop.
 * @param directives - Active gap directives to classify directive vs emphasis ops.
 * @returns Ops within hard limits.
 */
function enforceOpCaps(
  ops: import("./types").PatchOp[],
  directives: GapDirective[],
  config: ResumeGenConfig,
): import("./types").PatchOp[] {
  const isPatchTotal = config.mode === "patch_total";
  const MAX_TOTAL = isPatchTotal
    ? (config.patch_total_max_ops ?? 16)
    : 8;
  const MAX_EMPH_PER_ROLE = isPatchTotal
    ? (config.patch_total_max_emph_per_role ?? 3)
    : 2;

  const directiveRoles = new Set(
    directives
      .filter(d => d.handling === "fabricate" || d.handling === "reframe")
      .map(d => d.target_role)
      .filter(Boolean) as string[],
  );

  const isDirectiveOp = (op: import("./types").PatchOp) =>
    directiveRoles.size > 0 &&
    [...directiveRoles].some(r => r.toLowerCase().trim() === op.role.toLowerCase().trim());

  const allDirectiveOps = ops.filter(isDirectiveOp);
  const emphasisOps = ops.filter(op => !isDirectiveOp(op));

  // Directive ops are preserved first but still subject to the total ceiling.
  const directiveOps = allDirectiveOps.slice(0, MAX_TOTAL);
  if (allDirectiveOps.length > MAX_TOTAL) {
    console.warn(`[patch] enforceOpCaps: ${allDirectiveOps.length} directive ops exceed total cap ${MAX_TOTAL} — dropping ${allDirectiveOps.length - MAX_TOTAL} later directive op(s)`);
  }

  const emphSlots = Math.max(0, MAX_TOTAL - directiveOps.length);

  const roleEmphCount = new Map<string, number>();
  const keptEmphasis: import("./types").PatchOp[] = [];

  for (const op of emphasisOps) {
    if (keptEmphasis.length >= emphSlots) {
      console.warn(`[patch] enforceOpCaps: dropped emphasis op for role "${op.role}" item ${(op as { item?: number }).item} — total cap reached`);
      break;
    }
    const key = op.role.toLowerCase().trim();
    const count = roleEmphCount.get(key) ?? 0;
    if (count >= MAX_EMPH_PER_ROLE) {
      console.warn(`[patch] enforceOpCaps: dropped emphasis op for role "${op.role}" item ${(op as { item?: number }).item} — per-role cap reached`);
      continue;
    }
    roleEmphCount.set(key, count + 1);
    keptEmphasis.push(op);
  }

  return [...directiveOps, ...keptEmphasis];
}
