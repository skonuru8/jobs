/**
 * dash-lint.ts — Dash normalization for human-facing artifact text.
 *
 * Rewrites resume date ranges and prose separators so generated output avoids
 * brittle dash-heavy formatting. Callers use this before presenting content in
 * markdown, JSON, or plain-text channels.
 *
 * Called by: text cleanup and artifact serialization stages
 * Writes to: nothing
 * Side effects: none
 */

/** Month-name matcher used to preserve employment date ranges during cleanup. */
const MONTH =
  /(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)/i;
/** Four-digit year matcher for resume timeline text. */
const YEAR = /(?:19|20)\d{2}/;
/** Single date token matcher for month-year, bare year, or current-role markers. */
const DATE = new RegExp(`${MONTH.source}\\s+${YEAR.source}|${YEAR.source}|Present|present|Current|current`);
/** Global matcher for date ranges that should become `to` instead of comma-separated fragments. */
const DATE_RANGE = new RegExp(
  `(${DATE.source})\\s*(?:-{2,3}|\\u2013|\\u2014)\\s*(${DATE.source})`,
  "g",
);

/**
 * Replaces dash separators with safer prose punctuation while preserving date ranges.
 *
 * Converts timeline dashes into `to` first, then normalizes remaining dash separators
 * into commas so downstream renderers do not mis-handle Unicode dash variants.
 *
 * @param text - Raw generated text that may contain en/em dashes or repeated hyphens.
 * @returns Text with date ranges preserved and other dash separators normalized.
 * @throws Does not throw.
 */
export function stripDashes(text: string): string {
  return text
    .replace(DATE_RANGE, "$1 to $2")
    .replace(/\s*-{3}\s*/g, ", ")
    .replace(/\s*-{2}\s*/g, ", ")
    .replace(/\s*[\u2013\u2014]\s*/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/,\s{2,}/g, ", ");
}
