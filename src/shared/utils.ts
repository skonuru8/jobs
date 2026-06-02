/** Escapes a string for safe use in `new RegExp(...)`. */
export function escapeRegexStr(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Applies tech swaps deterministically to a plain-text or LaTeX string.
 * Uses word-boundary-safe lookarounds instead of `\b` so multi-word names work.
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
