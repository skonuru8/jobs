/**
 * coverage.ts — Heuristic directive-coverage audit for patch mode.
 *
 * Checks whether fabricate/reframe directives appear to land inside targeted
 * role blocks after patch application by scanning for directive keywords in the
 * patched role text. Audit is intentionally lightweight: it is safety net for
 * retrying missed directives, not semantic truth judge.
 *
 * Called by: patch orchestrator
 * Writes to: nothing
 * Side effects: none
 */

import type { GapDirective } from "@/judge/types";

import { extractRoleBlocks, findRoleBlock } from "./parser";
import type { PatchCoverage } from "./types";

/** Short but meaningful tech abbreviations that must survive the length filter. */
const TECH_SHORT_TERMS = new Set([
  "aws", "sql", "api", "k8s", "etl", "iam", "sso", "pci", "sox",
  "go", "ml", "ci", "cd", "nlp", "llm", "mq", "gcp", "rds",
]);

/**
 * Low-signal tokens ignored during keyword extraction for coverage checks.
 *
 * These words are common enough to create false positives without improving
 * confidence that directive-specific evidence actually landed in output.
 */
const STOPWORDS = new Set([
  "with", "from", "that", "this", "your", "role", "using", "have", "into",
  "and", "for", "the", "are", "was", "were", "will", "their", "across",
]);

/**
 * Audits whether patch output appears to cover active fabricate/reframe directives.
 *
 * Coverage passes when at least one extracted keyword from directive requirement
 * or framing hint appears inside target role block. Missing target roles or zero
 * keyword overlap are both treated as misses for retry purposes.
 *
 * @param tex - Patched resume LaTeX to inspect.
 * @param directives - Raw gap directives from judge output.
 * @returns Coverage counts plus list of still-missed `jd_requirement` strings.
 */
export function verifyPatchCoverage(tex: string, directives: GapDirective[]): PatchCoverage {
  const active = directives.filter(d =>
    (d.handling === "fabricate" || d.handling === "reframe") && d.target_role,
  );
  const blocks = extractRoleBlocks(tex);
  const missed: string[] = [];

  for (const d of active) {
    const block = findRoleBlock(blocks, d.target_role ?? "");
    if (!block) {
      missed.push(d.jd_requirement);
      continue;
    }
    const roleText = tex.slice(block.startOffset, block.endOffset).toLowerCase();
    const terms = keywords(`${d.jd_requirement} ${d.frame_as ?? ""}`);
    if (terms.length === 0 || !terms.some(t => roleText.includes(t))) {
      missed.push(d.jd_requirement);
    }
  }

  return {
    covered: active.length - missed.length,
    total: active.length,
    missed,
  };
}

/**
 * Extracts bounded set of meaningful lowercase keywords from directive text.
 *
 * Capped keyword list keeps audit cheap and reduces false positives from long
 * directive phrasing. TeX commands are stripped so coverage focuses on content.
 *
 * @param text - Directive requirement plus optional framing hint.
 * @returns Up to eight de-duplicated keywords suitable for substring checks.
 */
function keywords(text: string): string[] {
  return [...new Set(
    text
      .toLowerCase()
      .replace(/\\[a-z]+/g, " ")
      .split(/[^a-z0-9+#.]+/g)
      .map(s => s.trim())
      .filter(s => (s.length >= 4 || TECH_SHORT_TERMS.has(s)) && !STOPWORDS.has(s)),
  )].slice(0, 8);
}
