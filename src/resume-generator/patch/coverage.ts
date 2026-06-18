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
import type { PatchCoverage, PatchOp } from "./types";

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
 * Audits whether applied patch ops actually cover active fabricate/reframe directives.
 *
 * Coverage is checked against the ops that were applied, not pre-existing canonical
 * text. This prevents false positives where `frame_as` keywords already present in
 * canonical bullets cause untouched resumes to appear covered.
 *
 * - fabricate: requires a keyword from `jd_requirement` to appear in at least one
 *   op (new_item / item) that targeted the directive's role.
 * - reframe: requires at least one op of any type to target the directive's role
 *   (the JD term is intentionally absent from reframe bullets by design).
 *
 * @param tex - Patched resume LaTeX (used only to verify target role exists).
 * @param directives - Raw gap directives from judge output.
 * @param ops - Patch ops that were actually applied.
 * @returns Coverage counts plus list of still-missed `jd_requirement` strings.
 */
export function verifyPatchCoverage(tex: string, directives: GapDirective[], ops: PatchOp[]): PatchCoverage {
  const active = directives.filter(d =>
    (d.handling === "fabricate" || d.handling === "reframe") && d.target_role,
  );
  const blocks = extractRoleBlocks(tex);
  const missed: string[] = [];

  for (const d of active) {
    const targetRole = d.target_role ?? "";
    const block = findRoleBlock(blocks, targetRole);
    if (!block) {
      missed.push(d.jd_requirement);
      continue;
    }

    const opsForRole = ops.filter(op => normalizeRole(op.role) === normalizeRole(targetRole));

    if (opsForRole.length === 0) {
      missed.push(d.jd_requirement);
      continue;
    }

    if (d.handling === "reframe") {
      // Reframe: any op on the role counts — JD term is intentionally absent.
      continue;
    }

    // fabricate: at least one op must contain a keyword from jd_requirement only.
    const reqTerms = keywords(d.jd_requirement);
    const opTexts = opsForRole.map(op => {
      if (op.type === "rewrite") return op.new_item?.toLowerCase() ?? "";
      if (op.type === "insert_after" || op.type === "insert_first") return op.item?.toLowerCase() ?? "";
      return "";
    });
    const covered = reqTerms.length > 0 && reqTerms.some(t => opTexts.some(txt => txt.includes(t)));
    if (!covered) {
      missed.push(d.jd_requirement);
    }
  }

  return {
    covered: active.length - missed.length,
    total: active.length,
    missed,
  };
}

function normalizeRole(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
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
