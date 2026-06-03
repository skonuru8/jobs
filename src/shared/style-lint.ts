/**
 * style-lint.ts — Phrase-level style guardrails for generated prose.
 *
 * Detects banned resume and cover-letter wording that overclaims transferability
 * or mirrors job-post language too literally. Callers use these checks to flag
 * generated text before artifacts ship.
 *
 * Called by: generation validation and post-processing lint stages
 * Writes to: nothing
 * Side effects: none
 */

/**
 * Regex patterns for wording the project treats as stylistically unsafe.
 * Each pattern targets phrasing that can sound inflated, evasive, or ATS-gamed.
 */
const BANNED_STYLE_PATTERNS = [
  /demonstrating transferable/i,
  /analogous to/i,
  /akin to/i,
  /parallel to/i,
  /whose syntax (?:and|or) features/i,
  /\bwhose syntax\b/i,
  /syntactically equivalent to/i,
  /foundational knowledge of/i,
  /working knowledge of/i,
  /transitional knowledge of/i,
  /deepening understanding/i,
  /directly applicable to/i,
  /translate[s]? directly to/i,
  /immediately useful in/i,
  /comparable to/i,
  /while not having direct/i,
  /with limited .* exposure/i,
  /transferable skills/i,
  /\baligning with your need for\b/i,
  /\bas required by the role\b/i,
  /\bhands-on exposure\b/i,
  /\bexposure to\b/i,
  /\bgained hands-on exposure\b/i,
];

/**
 * Returns source patterns for every banned phrase found in text.
 *
 * @param text - Generated prose to inspect before artifact save or display.
 * @returns Regex source strings for each matching banned phrase pattern.
 * @throws Does not throw.
 */
export function findBannedStylePhrases(text: string): string[] {
  return BANNED_STYLE_PATTERNS
    .filter(pattern => pattern.test(text))
    .map(pattern => pattern.source);
}

/**
 * Reports whether text contains any phrase blocked by style policy.
 *
 * @param text - Generated prose to scan for banned wording.
 * @returns `true` when at least one banned phrase pattern matches.
 * @throws Does not throw.
 */
export function hasBannedStylePhrase(text: string): boolean {
  return findBannedStylePhrases(text).length > 0;
}
