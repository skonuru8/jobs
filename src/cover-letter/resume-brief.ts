/**
 * Slice the EXPERIENCE section verbatim from canonical tex.
 * Preserves employer headers, role titles, dates, and per-role bullets exactly
 * as written — no extraction, no flattening — so the cover letter LLM cannot
 * mix employers, stacks, or metrics across roles.
 *
 * Also appends the PROJECTS section when present, labelled separately so the
 * LLM can use personal/side projects for gap bridging without confusing them
 * with work experience.
 *
 * Returns stripped plain-text with bullet structure preserved as line breaks.
 */
export function buildExperienceBlockFromCanonicalTex(tex: string): string {
  const strip = (raw: string) => raw
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

  const expStart = tex.match(/\\section\*?\{EXPERIENCE\}/);
  if (!expStart || expStart.index === undefined) {
    throw new Error("[resume-brief] EXPERIENCE section not found in canonical tex");
  }
  const afterExp = tex.slice(expStart.index + expStart[0].length);
  const expEnd = afterExp.match(/\\section\*?\{(PROJECTS|EDUCATION|AWARDS)\}/);
  const expRaw = expEnd?.index !== undefined ? afterExp.slice(0, expEnd.index) : afterExp;
  const expBlock = strip(expRaw);

  const projStart = tex.match(/\\section\*?\{PROJECTS\}/);
  if (!projStart || projStart.index === undefined) return expBlock;

  const afterProj = tex.slice(projStart.index + projStart[0].length);
  const projEnd = afterProj.match(/\\section\*?\{(EDUCATION|AWARDS|SKILLS)\}/);
  const projRaw = projEnd?.index !== undefined ? afterProj.slice(0, projEnd.index) : afterProj;
  const projBlock = strip(projRaw);

  return projBlock
    ? `${expBlock}\n\n=== CANDIDATE PROJECTS (personal/side projects — usable for gap bridging as "In a personal project...") ===\n\n${projBlock}`
    : expBlock;
}
