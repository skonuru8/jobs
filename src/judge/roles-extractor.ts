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

  // Anchor on top-level employer headers: \textbf{Company} \hfill <dates>.
  // Project sub-headers (\hspace{4mm}\textbf{Project: X}) have no \hfill, so they are
  // not anchors; their bullets fold into the preceding employer.
  const headerRe = /\\textbf\{([^}]+)\}\s*\\hfill\s*([^\\\n]+)/g;
  const anchors: { company: string; dates: string; start: number; headerEnd: number }[] = [];
  let hm: RegExpExecArray | null;
  while ((hm = headerRe.exec(block)) !== null) {
    const company = hm[1].trim();
    if (/^project:/i.test(company)) continue;
    anchors.push({ company, dates: hm[2].trim(), start: hm.index, headerEnd: headerRe.lastIndex });
  }
  if (anchors.length === 0) return "";

  const out: string[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const segEnd = i + 1 < anchors.length ? anchors[i + 1].start : block.length;
    const segment = block.slice(a.headerEnd, segEnd);

    const roleMatch = segment.match(/\\textit\{([^}]+)\}/);
    const role = roleMatch ? cleanLatexInline(roleMatch[1]) : "";
    out.push(role ? `## ${a.company} - ${role} (${a.dates})`
                  : `## ${a.company} (${a.dates})`);

    // One \item per line in this resume; tag bullets with their project sub-header.
    let currentProject = "";
    for (const raw of segment.split("\n")) {
      const line = raw.trim();
      const proj = line.match(/\\textbf\{Project:\s*([^}]+)\}/);
      if (proj) { currentProject = proj[1].trim(); continue; }
      if (line.startsWith("\\item")) {
        const bullet = cleanLatexInline(line.replace(/^\\item\s*/, "")).replace(/\s+/g, " ").trim();
        if (bullet) out.push(`  - ${currentProject ? `[${currentProject}] ` : ""}${bullet}`);
      }
    }
  }

  return out.join("\n");
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
