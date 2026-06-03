/**
 * utils.ts — Small shared text helpers used across tailoring modules.
 *
 * Centralizes regex-safe escaping and deterministic tech-name swap logic so
 * prompt builders and generators apply identical substitutions. These helpers
 * intentionally stay side-effect free because callers use them inside scoring,
 * resume generation, and cover-letter assembly.
 *
 * Called by: artifact-bundle.ts, resume and cover-letter generation helpers
 * Writes to: nothing
 * Side effects: none
 */

/**
 * Escapes literal text for safe interpolation into `new RegExp(...)`.
 *
 * @param s - Raw literal string that should be treated as text, not regex syntax.
 * @returns Regex-escaped string safe to embed in a dynamic pattern.
 * @throws Does not throw.
 */
export function escapeRegexStr(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Applies tech swaps deterministically to a plain-text or LaTeX string.
 * Uses word-boundary-safe lookarounds instead of `\b` so multi-word names work.
 *
 * @param text - Source text to rewrite without changing unrelated tokens.
 * @param swaps - Ordered replacements to apply; skipped when absent or empty.
 * @returns Text with all unscoped tech-name replacements applied in order.
 * @throws Does not throw.
 * @example
 * applyTechSwaps("Built APIs in Node.js", [{ from: "Node.js", to: "TypeScript" }]);
 */
export function applyTechSwaps(
  text: string,
  swaps: Array<{ from: string; to: string }> | undefined,
): string {
  if (!swaps?.length) return text;
  let result = text;
  for (const swap of swaps) {
    const escaped = escapeRegexStr(swap.from);
    const re = new RegExp(`(?<![a-zA-Z0-9])${escaped}(?![a-zA-Z0-9])`, "gi");
    result = result.replace(re, swap.to);
  }
  return result;
}

/**
 * Applies tech swaps to a plain-text experience block with target_role scoping.
 * Scoped swaps only apply within the employer section containing target_role.
 * Unscoped swaps apply across the full text.
 *
 * @param text - Experience block text split into employer sections by blank lines.
 * @param swaps - Ordered replacements with optional `target_role` scope.
 * @returns Text with global swaps applied everywhere and scoped swaps limited to matching sections.
 * @throws Does not throw.
 * @example
 * applyScopedTechSwaps(block, [{ from: "Flask", to: "FastAPI", target_role: "Backend Engineer" }]);
 */
export function applyScopedTechSwaps(
  text: string,
  swaps: Array<{ from: string; to: string; target_role: string | null }> | undefined,
): string {
  if (!swaps?.length) return text;

  let result = text;
  for (const swap of swaps) {
    if (!swap.target_role) {
      result = applyTechSwaps(result, [swap]);
      continue;
    }
    const targetRole = swap.target_role;
    const sections = result.split(/\n{2,}/);
    result = sections
      .map(section =>
        section.includes(targetRole)
          ? applyTechSwaps(section, [swap])
          : section,
      )
      .join("\n\n");
  }
  return result;
}
