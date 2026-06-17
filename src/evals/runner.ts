/**
 * runner.ts — Deterministic eval runner for resume + cover letter quality.
 *
 * Operates entirely on data already available at generation time (canonical TeX,
 * patch ops, judge directives, cover letter text). No LLM required. Designed to
 * run as a post-generation pass so it adds zero latency to the generation hot path.
 *
 * Called by: artifacts/manual-generate.ts (after writeCombinedMeta)
 * Writes to: nothing — returns EvalResult for caller to persist
 * Side effects: none
 */

import { findBannedStylePhrases, hasBannedStylePhrase } from "@/shared/style-lint";
import { extractRoleBlocks } from "@/resume-generator/patch/parser";
import type { EvalResult, EmphasisOpEval, DirectiveOpEval, ResumeEval, CoverLetterEval, OverallQuality } from "./types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface EvalInput {
  /** Canonical resume TeX source (before patches). */
  canonicalTex: string;
  /** Judge tailoring hints — emphasize_roles, emphasize_skills, gap_directives. */
  judgeJson: {
    tailoring_hints?: {
      emphasize_roles?: string[];
      emphasize_skills?: string[];
    };
    gap_directives?: Array<{
      handling: string;
      target_role?: string;
      jd_requirement?: string;
    }>;
  };
  /** Patch ops actually applied (from patch result). */
  patchOps?: Array<{
    type: "rewrite" | "insert_after" | "insert_first";
    role: string;
    item?: number;
    after_item?: number;
    new_item?: string;
    item_text?: string;
  }>;
  /** Flags already collected from patch result (resume). */
  resumeFlags?: string[];
  /** Patch prompt SHA (for trend attribution). */
  patchPromptSha?: string | null;
  /** Cover letter plain text body (post-strip). */
  coverLetterText?: string | null;
  /** Cover letter flags. */
  coverFlags?: string[];
  /** Cover letter word count. */
  coverWordCount?: number;
  /** Cover letter prompt SHA. */
  coverPromptSha?: string | null;
}

export function runEvals(input: EvalInput): EvalResult {
  const roleBlocks = extractRoleBlocks(input.canonicalTex);
  const emphRoles = input.judgeJson.tailoring_hints?.emphasize_roles ?? [];
  const emphSkills = input.judgeJson.tailoring_hints?.emphasize_skills ?? [];
  const gapDirectives = input.judgeJson.gap_directives ?? [];
  const directiveRoles = new Set(
    gapDirectives
      .filter(d => d.handling === "fabricate" || d.handling === "reframe")
      .map(d => d.target_role)
      .filter(Boolean) as string[],
  );

  const ops = input.patchOps ?? [];

  // Classify ops: emphasis = op role is in emphRoles but NOT in directiveRoles
  const emphasisOps = ops.filter(op =>
    op.type === "rewrite" &&
    emphRoles.some(r => normalizeRole(r) === normalizeRole(op.role)) &&
    !directiveRoles.has(op.role) &&
    !Array.from(directiveRoles).some(dr => normalizeRole(dr) === normalizeRole(op.role)),
  );

  const directiveOps = ops.filter(op =>
    (op.type === "rewrite" || op.type === "insert_after" || op.type === "insert_first") &&
    Array.from(directiveRoles).some(dr => normalizeRole(dr) === normalizeRole(op.role)),
  );

  const emphasisEvals: EmphasisOpEval[] = emphasisOps.map(op => {
    const block = roleBlocks.find(b => normalizeRole(b.role) === normalizeRole(op.role));
    const originalItem = block?.items.find(i => i.index === op.item);
    const original = originalItem?.text ?? "";
    const rewritten = op.new_item ?? "";
    return evalEmphasisOp(original, rewritten, op.role, op.item ?? 0, emphSkills);
  });

  const directiveEvals: DirectiveOpEval[] = [];
  for (const directive of gapDirectives.filter(d =>
    (d.handling === "fabricate" || d.handling === "reframe") && d.target_role,
  )) {
    const relatedOps = directiveOps.filter(
      op => normalizeRole(op.role) === normalizeRole(directive.target_role!),
    );
    for (const op of relatedOps) {
      const bulletText = op.new_item ?? (op as { item?: string }).item ?? "";
      const block = roleBlocks.find(b => normalizeRole(b.role) === normalizeRole(op.role));
      const roleText = block?.items.map(i => i.text).join(" ") ?? "";
      directiveEvals.push(evalDirectiveOp(directive.jd_requirement ?? "", directive.handling as "fabricate" | "reframe", op.role, bulletText, roleText));
    }
  }

  const resumeEval: ResumeEval = {
    emphasis_ops: emphasisEvals,
    directive_ops: directiveEvals,
    flags: input.resumeFlags ?? [],
    overall_quality: rollUpResumeQuality(emphasisEvals, directiveEvals, input.resumeFlags ?? []),
  };

  let coverLetterEval: CoverLetterEval | null = null;
  if (input.coverLetterText !== undefined) {
    const text = input.coverLetterText ?? "";
    const bannedFound = text ? findBannedStylePhrases(text) : [];
    coverLetterEval = {
      word_count: input.coverWordCount ?? 0,
      banned_phrase: bannedFound.length > 0,
      banned_phrases_found: bannedFound,
      overall_quality: rollUpCoverQuality(bannedFound, input.coverFlags ?? [], input.coverWordCount ?? 0),
    };
  }

  return {
    run_at: new Date().toISOString(),
    version: "1.0",
    patch_prompt_sha: input.patchPromptSha ?? null,
    cover_prompt_sha: input.coverPromptSha ?? null,
    resume: resumeEval,
    cover_letter: coverLetterEval,
  };
}

// ---------------------------------------------------------------------------
// Emphasis op evaluation (deterministic)
// ---------------------------------------------------------------------------

function evalEmphasisOp(
  original: string,
  rewritten: string,
  role: string,
  item: number,
  emphSkills: string[],
): EmphasisOpEval {
  const origTerms = extractKeyTerms(original);
  const rewrittenNorm = normalizeForSearch(rewritten);
  const droppedTerms = origTerms.filter(t => !rewrittenNorm.includes(normalizeForSearch(t)));

  const specificityPreserved = origTerms.length > 0
    ? (origTerms.length - droppedTerms.length) / origTerms.length
    : 1.0;

  const techForwardGain = computeTechForwardGain(original, rewritten, emphSkills);
  const infoLoss = droppedTerms.length > 0;
  const netQuality = infoLoss ? "degraded" : techForwardGain > 0 ? "improved" : "neutral";

  return {
    role,
    item,
    original,
    rewritten,
    scores: { specificity_preserved: specificityPreserved, tech_forward_gain: techForwardGain, info_loss: infoLoss, net_quality: netQuality },
    dropped_phrases: droppedTerms,
  };
}

/**
 * Extracts key terms from a LaTeX bullet: named tech terms, concrete noun phrases, metrics.
 *
 * Focuses on what actually matters for quality evaluation — NOT action verbs.
 * Verb changes (Contributed → Delivered, Architected → Built) are always acceptable
 * emphasis rewrites and must not trigger false positives.
 *
 * Tracked:
 * 1. Tech names / named entities — capitalized multi-word terms (Spring Boot, Azure Pipelines)
 * 2. Specific context nouns — phrases like "forms used for manual ticket creation",
 *    "monolithic architecture", etc. (introduced by "for", "across", "using" etc.)
 * 3. Quantitative metrics — numbers with %, +, k, M etc.
 *
 * Not tracked: action verbs, generic adjectives, common nouns without specificity.
 */
function extractKeyTerms(tex: string): string[] {
  const ACTION_VERBS = new Set([
    "architected","built","contributed","delivered","designed","developed","drove",
    "engineered","ensured","implemented","integrated","launched","led","managed",
    "maintained","modernized","operated","owned","provisioned","reduced","scaled",
    "served","set","strengthened","supported","wrote","created","established",
    "handled","performed","applied","established","tracked","updated","resolved",
  ]);

  const clean = tex
    .replace(/\\textbf\{([^}]+)\}/g, "$1")
    .replace(/\\item\s*/g, "")
    .replace(/\\[a-zA-Z]+(\{[^}]*\})?/g, " ")
    .replace(/[{}\\%$#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const terms: string[] = [];

  // 1. Tech names: runs of one or more capitalized words (optionally joined by /,+,and,or)
  //    e.g. "Spring Boot", "Azure Pipelines", "Docker", "DynamoDB"
  const techRe = /(?<![a-z])[A-Z][a-zA-Z0-9]+(?:[\s\/+](?:[A-Z][a-zA-Z0-9]+|and|or))*(?=[\s,;.)]|$)/g;
  for (const m of clean.matchAll(techRe)) {
    const term = m[0].replace(/\s+(and|or)\s*$/, "").trim();
    const firstWord = term.split(/\s+/)[0];
    // skip action verbs (including sentence-initial capitalized ones)
    if (ACTION_VERBS.has(firstWord.toLowerCase())) continue;
    if (term.length >= 3) terms.push(term);
  }

  // 2. Specific concrete noun phrases introduced by context prepositions
  //    e.g. "for manual ticket creation", "across a monolithic architecture"
  //    Require at least 2 qualifying words (excluding bare "the platform" etc.)
  const contextRe = /\b(?:for|across|of|within)\s+(?:the\s+|a\s+|an\s+)?([a-z][a-z\s]+?(?:architecture|creation|workflow|pipeline|service|system|stack|process|environment|integration|infrastructure|configuration|framework|mechanism))\b/gi;
  for (const m of clean.matchAll(contextRe)) {
    const phrase = m[1].trim();
    if (phrase.split(/\s+/).length >= 2) terms.push(phrase);
  }

  // 3. Metrics: numbers with explicit units or significant magnitude
  //    Exclude bare single/double-digit numbers without units (e.g. "2," from enumerations)
  for (const m of clean.matchAll(/\d[\d,.]*\s*(?:[%+xkKmMbB]|\bGB\b|\bms\b|\bsec\b|\bmin\b)\b/g)) {
    terms.push(m[0].trim());
  }
  // Also include counts like "10+", "50+" (with explicit + sign)
  for (const m of clean.matchAll(/\d{2,}[+]/g)) {
    terms.push(m[0].trim());
  }

  // Deduplicate; drop shorter terms already covered by a longer term
  const unique = [...new Set(terms)];
  return unique.filter(t =>
    !unique.some(u => u !== t && normalizeForSearch(u).includes(normalizeForSearch(t)) && u.length > t.length + 3),
  );
}

function normalizeForSearch(s: string): string {
  return s
    .replace(/\\textbf\{([^}]+)\}/g, "$1")
    .replace(/\\[a-zA-Z]+(\{[^}]*\})?/g, " ")
    .replace(/[{}\\%$#]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Measures how many EMPHASIS_SKILLS terms are newly wrapped in \textbf{} in the rewrite.
 * Returns 0–1 where 1 means all skills were added as bold that weren't before.
 */
function computeTechForwardGain(original: string, rewritten: string, emphSkills: string[]): number {
  if (emphSkills.length === 0) return 0;
  const boldPattern = (skill: string) => new RegExp(`\\\\textbf\\{[^}]*${escapeRegex(skill)}[^}]*\\}`, "i");
  const origBolded = emphSkills.filter(s => boldPattern(s).test(original));
  const rewriteBolded = emphSkills.filter(s => boldPattern(s).test(rewritten));
  const newlyBolded = rewriteBolded.filter(s => !origBolded.includes(s));
  const possible = emphSkills.filter(s => !origBolded.includes(s));
  return possible.length > 0 ? newlyBolded.length / possible.length : 0;
}

// ---------------------------------------------------------------------------
// Directive op evaluation (deterministic)
// ---------------------------------------------------------------------------

function evalDirectiveOp(
  jdRequirement: string,
  handling: "fabricate" | "reframe",
  role: string,
  bulletText: string,
  sourceRoleText: string,
): DirectiveOpEval {
  const bulletNorm = normalizeForSearch(bulletText);
  const req = jdRequirement.trim().toLowerCase();
  const requirementAddressed = req.length === 0 || bulletNorm.includes(req.split(/\s+/)[0]);

  const metricInBullet = extractMetrics(bulletText);
  const metricInSource = extractMetrics(sourceRoleText);
  const metricOverclaim = metricInBullet.some(m => !metricInSource.some(s => s === m));

  return {
    role,
    jd_requirement: jdRequirement,
    handling,
    scores: {
      requirement_addressed: requirementAddressed,
      metric_overclaim: metricOverclaim,
      banned_phrase: hasBannedStylePhrase(bulletText),
    },
  };
}

function extractMetrics(text: string): string[] {
  return (text.match(/\d+[\d,.]*\s*[%+xkKmMbB]?\b/g) ?? []).map(m => m.trim());
}

// ---------------------------------------------------------------------------
// Roll-up quality verdicts
// ---------------------------------------------------------------------------

function rollUpResumeQuality(
  emphasisEvals: EmphasisOpEval[],
  directiveEvals: DirectiveOpEval[],
  flags: string[],
): OverallQuality {
  if (flags.includes("resume_gen_failed")) return "fail";
  if (emphasisEvals.some(e => e.scores.info_loss)) return "fail";
  if (directiveEvals.some(d => d.scores.banned_phrase)) return "fail";
  if (flags.some(f => f.startsWith("patch_diff_lint_failed") || f === "banned_phrase_in_output")) return "warning";
  if (directiveEvals.some(d => d.scores.metric_overclaim)) return "warning";
  if (flags.includes("resume_attribution_overrun")) return "warning";
  return "ok";
}

function rollUpCoverQuality(
  bannedFound: string[],
  flags: string[],
  wordCount: number,
): OverallQuality {
  if (flags.includes("cover_letter_gen_failed")) return "fail";
  if (bannedFound.length > 0) return "fail";
  if (wordCount > 0 && wordCount < 350) return "warning";
  return "ok";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeRole(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
