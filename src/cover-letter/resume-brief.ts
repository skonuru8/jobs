/**
 * Slice the EXPERIENCE section verbatim from canonical tex.
 * Preserves employer headers, role titles, dates, and per-role bullets exactly
 * as written — no extraction, no flattening — so the cover letter LLM cannot
 * mix employers, stacks, or metrics across roles.
 *
 * Returns the EXPERIENCE section as a plain-text block with LaTeX commands
 * stripped (but employer headers and bullet structure preserved as line breaks).
 */
export function buildExperienceBlockFromCanonicalTex(tex: string): string {
  const startMarker = /\\section\*?\{EXPERIENCE\}/;
  const endMarker = /\\section\*?\{(PROJECTS|EDUCATION|AWARDS)\}/;

  const startMatch = tex.match(startMarker);
  if (!startMatch || startMatch.index === undefined) {
    throw new Error("[resume-brief] EXPERIENCE section not found in canonical tex");
  }
  const afterStart = tex.slice(startMatch.index + startMatch[0].length);

  const endMatch = afterStart.match(endMarker);
  const expRaw = endMatch && endMatch.index !== undefined
    ? afterStart.slice(0, endMatch.index)
    : afterStart;

  return expRaw
    .replace(/\\textbf\{([^}]*)\}/g, "$1")
    .replace(/\\textit\{([^}]*)\}/g, "$1")
    .replace(/\\hfill/g, " | ")
    .replace(/\\hspace\{[^}]*\}/g, "")
    .replace(/\\vspace\{[^}]*\}/g, "")
    .replace(/\\begin\{itemize\}/g, "")
    .replace(/\\end\{itemize\}/g, "")
    .replace(/\\item\s*/g, "  - ")
    .replace(/\\\\/g, "")
    .replace(/\$\|\$/g, "|")
    .replace(/\\%/g, "%")
    .replace(/\\&/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
