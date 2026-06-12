/**
 * diff-lint.ts — Post-apply accountability checks for patch mode.
 *
 * Runs four checks on applied ops and patched tex before warnings synthesis.
 * Violations feed into a retryHint for the second planner attempt; persisting
 * violations become flags. Never silently passes.
 *
 * Called by: patch orchestrator
 * Writes to: nothing
 * Side effects: none
 */

import { hasBannedStylePhrase } from "@/shared/style-lint";

import type { GapDirective } from "@/judge/types";
import { countWordsTex } from "../generator";
import type { PatchOp } from "./types";

export interface DiffLintResult {
  /** Human-readable descriptions of violations found, for retryHint injection. */
  violations: string[];
  /** Flag names (patch_diff_lint_failed:<check>) for persistent failures. */
  flags: string[];
}

/**
 * Runs post-apply accountability checks on patch output.
 *
 * Checks:
 *  1. `forbid` directive terms absent from all inserted/rewritten bullet text.
 *  2. No banned style phrases in any inserted/rewritten bullet.
 *  3. Final word count within [wordCountMin, wordCountMax].
 *
 * @param patchedTex - Patched resume LaTeX after applyPatchOps.
 * @param ops - Validated ops that were applied.
 * @param directives - All gap directives including forbid entries.
 * @param wordCountMin - Minimum word count; 0 or undefined to skip.
 * @param wordCountMax - Maximum word count; 0 or undefined to skip.
 */
export function runDiffLint(
  patchedTex: string,
  ops: PatchOp[],
  directives: GapDirective[],
  wordCountMin?: number,
  wordCountMax?: number,
): DiffLintResult {
  const violations: string[] = [];
  const flags: string[] = [];

  const bulletTexts = ops.map(op => {
    if (op.type === "rewrite") return op.new_item;
    return op.item;
  });

  // Check 1: forbid terms absent from inserted/rewritten bullets
  const forbidDirectives = directives.filter(d => d.handling === "forbid" && d.jd_requirement);
  for (const d of forbidDirectives) {
    const term = d.jd_requirement.trim();
    if (!term) continue;
    const pattern = new RegExp(`\\b${escapeRegex(term)}\\b`, "i");
    for (const bullet of bulletTexts) {
      if (pattern.test(bullet)) {
        violations.push(`forbid_term_present: "${term}" found in inserted/rewritten bullet`);
        flags.push(`patch_diff_lint_failed:forbid_term`);
        break;
      }
    }
  }

  // Check 2: banned style phrases per-bullet
  for (const bullet of bulletTexts) {
    if (hasBannedStylePhrase(bullet)) {
      violations.push(`banned_phrase_in_bullet: "${bullet.slice(0, 80).trim()}..."`);
      if (!flags.includes("patch_diff_lint_failed:banned_phrase")) {
        flags.push("patch_diff_lint_failed:banned_phrase");
      }
    }
  }

  // Check 3: final word count within bounds
  if (wordCountMin || wordCountMax) {
    const wc = countWordsTex(patchedTex);
    if (wordCountMin && wc < wordCountMin) {
      violations.push(`word_count_too_short: ${wc} < ${wordCountMin}`);
      flags.push("patch_diff_lint_failed:word_count");
    }
    if (wordCountMax && wc > wordCountMax) {
      violations.push(`word_count_too_long: ${wc} > ${wordCountMax}`);
      flags.push("patch_diff_lint_failed:word_count");
    }
  }

  return { violations: [...new Set(violations)], flags: [...new Set(flags)] };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
