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
  // Transfer / analogy language
  /demonstrating transferable/i,
  /demonstrates transferable/i,
  /analogous to/i,
  /akin to/i,
  /parallel to/i,
  /similar to/i,
  /whose syntax (?:and|or) features/i,
  /\bwhose syntax\b/i,
  /syntactically equivalent to/i,
  /comparable to/i,
  /while not having direct/i,
  /transferable skills/i,
  /translate[s]? directly to/i,
  /immediately useful in/i,

  // Knowledge / exposure hedging
  /foundational knowledge of/i,
  /working knowledge of/i,
  /transitional knowledge of/i,
  /deepening understanding/i,
  /with limited .* exposure/i,
  /\bhands-on exposure\b/i,
  /\bexposure to\b/i,
  /\bgained hands-on exposure\b/i,
  /\bgaining hands-on experience\b/i,
  /\bgain(?:ing|ed)? familiarity with\b/i,
  /\bgaining familiarity\b/i,

  // JD-targeting tails
  /directly applicable to/i,
  /\bapplicable to\b/i,
  /\baligning with your need for\b/i,
  /\bas required by the role\b/i,
  /\baligns with the requirements\b/i,
  /\bto meet (?:the|your) requirements\b/i,

  // AI-generated quality-signal phrases (no substance)
  /\bdemonstrating (?:strong|holistic|comprehensive|solid|deep|real-world|direct|full|broad)\b/i,
  /\bdemonstrates (?:strong|holistic|comprehensive|solid|deep|real-world|direct|full|broad)\b/i,
  /\bdirectly demonstrates\b/i,
  /\bmaps directly\b/i,
  /\bmirrors the\b/i,
  /\brapidly adapt\b/i,
  /\bposition(?:s|ed)? (?:me|the candidate) (?:to|for)\b/i,
];

/**
 * Human-readable phrase strings corresponding to BANNED_STYLE_PATTERNS,
 * used to embed the banned list into LLM system prompts.
 */
export const BANNED_STYLE_PHRASE_STRINGS: readonly string[] = [
  // Transfer / analogy language
  "demonstrating transferable", "demonstrates transferable",
  "analogous to", "akin to", "parallel to", "similar to",
  "whose syntax and/or features", "whose syntax",
  "syntactically equivalent to", "comparable to",
  "while not having direct", "transferable skills",
  "translate directly to", "translates directly to",
  "immediately useful in",
  // Knowledge / exposure hedging
  "foundational knowledge of", "working knowledge of",
  "transitional knowledge of", "deepening understanding",
  "with limited exposure",
  "hands-on exposure", "exposure to", "gained hands-on exposure",
  "gaining hands-on experience", "gaining familiarity with",
  // JD-targeting tails
  "directly applicable to", "applicable to",
  "aligning with your need for", "as required by the role",
  "aligns with the requirements", "to meet the requirements",
  // AI-generated quality claims with no substance
  "demonstrating strong", "demonstrating holistic", "demonstrating comprehensive",
  "demonstrating solid", "demonstrating deep", "demonstrating real-world",
  "demonstrating direct", "demonstrating full", "demonstrating broad",
  "directly demonstrates", "maps directly", "mirrors the",
  "rapidly adapt",
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

/**
 * Removes clauses containing banned style phrases from bullet text.
 *
 * Strips the clause boundary (comma, semicolon, em-dash, preceding whitespace)
 * and everything from the banned phrase to end of line. Defense-in-depth sanitizer
 * applied to patch-generated bullets before they reach canonical TeX.
 *
 * @param text - Raw bullet text that may contain banned phrases.
 * @returns Bullet text with banned-phrase clauses excised and whitespace normalized.
 * @throws Does not throw.
 */
export function stripBannedStyleClauses(text: string): string {
  let result = text;
  for (const pattern of BANNED_STYLE_PATTERNS) {
    const src = pattern.source;
    // Strip clause after separator (comma, semicolon, em-dash, en-dash) or preceding whitespace
    result = result.replace(
      new RegExp(
        `(?:[,;]\\s*|\\s*[—–]\\s*|\\s+)${src}[^\\n]*`,
        "gi",
      ),
      "",
    );
  }
  return result
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\.\s*\./g, ".")
    .replace(/,\s*\./g, ".")
    .trim();
}
