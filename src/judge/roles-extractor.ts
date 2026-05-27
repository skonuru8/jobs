import * as fs from "fs";

/**
 * Pull a compact work-history block from canonical resume TeX for the judge.
 * Graceful degradation: returns "" if EXPERIENCE section or patterns don't match.
 */
export function extractRolesFromCanonicalResume(canonicalTexPath: string): string {
  let tex: string;
  try {
    tex = fs.readFileSync(canonicalTexPath, "utf8");
  } catch {
    return "";
  }
  return extractRolesFromCanonicalTex(tex);
}

export function extractRolesFromCanonicalTex(tex: string): string {
  const exp = tex.match(
    /\\section\*\{EXPERIENCE\}([\s\S]*?)(?=\\section\*\{|\\end\{document\})/i,
  );
  if (!exp) return "";
  const block = exp[1];
  const roles: string[] = [];

  // Primary pattern: \textbf{Company} \hfill dates\\ then \textit{Role} (resume_master.tex)
  const blockIter = block.matchAll(
    /\\textbf\{([^}]+)\}\s*\\hfill\s*([^\\\n]+)[\s\n]*(?:\\\\)?\s*(?:\\vspace\{[^}]+\}\s*)?\\textit\{([^}]+)\}/g,
  );
  for (const m of blockIter) {
    const company = m[1].trim();
    if (/^project:/i.test(company)) continue;
    roles.push(`${company} - ${cleanLatexInline(m[3])} (${m[2].trim()})`);
  }

  if (roles.length) return roles.join("\n");

  // Fallback: company \textbf lines only (no role line matched)
  const simple = block.matchAll(/\\textbf\{([^}]+)\}\s*\\hfill\s*([^\\\n]+)/g);
  for (const m of simple) {
    const company = m[1].trim();
    if (/^project:/i.test(company)) continue;
    roles.push(`${company} (${m[2].trim()})`);
  }

  return roles.slice(0, 12).join("\n");
}

function cleanLatexInline(value: string): string {
  return value
    .replace(/\$\\?\|\$/g, "|")
    .replace(/\\[a-zA-Z]+\*?\{([^}]*)\}/g, "$1")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract and clean the SKILLS section text from canonical resume TeX.
 * Used by the judge prompt so the LLM can avoid flagging known skills as gaps.
 */
export function extractSkillsSectionFromCanonical(canonicalTexPath: string): string {
  let tex: string;
  try {
    tex = fs.readFileSync(canonicalTexPath, "utf8");
  } catch {
    return "";
  }
  const m = tex.match(/\\section\*?\{SKILLS\}([\s\S]*?)(?=\\section\*?\{|\\end\{document\})/i);
  if (!m) return "";
  return m[1]
    .replace(/\\textbf\{([^}]*)\}/g, "$1")
    .replace(/\\\\/g, "\n")
    .replace(/\\[a-zA-Z]+\*?\{?/g, "")
    .replace(/[{}]/g, "")
    .trim();
}
