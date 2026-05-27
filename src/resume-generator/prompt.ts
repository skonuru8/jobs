/**
 * prompt.ts — loads skills/resume-tailor/SKILL.md and builds TOTAL_MODE_PROMPT.
 */

import * as crypto from "crypto";
import * as fs     from "fs";
import * as path   from "path";
import { fileURLToPath } from "url";

import type { GapDirective, TechSwap } from "@/judge/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const SKILL_PATH = path.join(REPO_ROOT, "skills", "resume-tailor", "SKILL.md");

const skillContent = fs.readFileSync(SKILL_PATH, "utf8");

const PIPELINE_OVERRIDE = `
========================================================================
PIPELINE EXECUTION OVERRIDE — READ CAREFULLY
========================================================================

You are running in autonomous pipeline mode (TOTAL mode), not interactive chat.
The skill rules above remain in force EXCEPT where this override modifies them.

--- SOURCE OF RESUME ---
The canonical resume to tailor is provided as LaTeX in this user message under the
section labelled CANONICAL_RESUME. Use this as the source. Do NOT reference any
"project knowledge", "chat history", or any other resume. The canonical LaTeX in
this message is the sole and authoritative source.

--- AUTONOMOUS EXECUTION ---
- Skip Phase 3 (approval round) entirely. Auto-approve every change you would
  have proposed. Do NOT print proposals. Do NOT ask for confirmation.
- Skip Phase 6 (ATS Audit report). You may apply ATS fixes internally to the
  output, but do NOT print the report.
- Skip Phase 7 deliverables 2 through 7 (summary of changes, key highlights,
  domain reframes notes, tech changes log, ATS audit report, cover letter offer).
- Deliver ONLY Phase 7 deliverable #1: the updated resume.

--- OUTPUT FORMAT — STRICT ---
- Output the COMPLETE updated resume as valid LaTeX.
- The FIRST character of your response must be the backslash of \\documentclass.
- The LAST non-whitespace token of your response must be \\end{document}.
- Preserve the canonical resume's documentclass, packages, geometry, and all
  preamble commands EXACTLY. Do not change the document class. Do not add or
  remove packages.
- No markdown fences (no \`\`\`latex, no \`\`\`).
- No commentary, no preamble, no afterword, no explanations.
- No proposal-block tags ([MODE A / REFRAME], [MODE C / INTEGRATION],
  [FABRICATED], [TRUE GAP], [MODE A / DOMAIN REFRAME], etc.) anywhere in the
  output. These are proposal markers for chat use only; the final resume must
  read clean.
- No "=== CHANGES MADE ===" block or any other meta-section.
- No instructions to the reader, no "Note:" lines, no parenthetical asides
  explaining what was changed.

--- BEHAVIOR — UNCHANGED FROM SKILL ---
- Apply all four modes (A, B, C, D) as described above.
- Honor CAR/STAR framework for every new/rewritten bullet.
- Bold all quantifiable metrics.
- Never delete skills; only add or reorder.
- Never delete experience bullets, sub-bullets, or projects. The canonical
  resume's complete content MUST appear in the output. You may add, reorder,
  re-emphasize, or rewrite phrasing, but every canonical bullet and every
  project under PROJECTS must remain in the output. Relevance signaling is done
  by REORDERING (lead with most JD-relevant), NOT by REMOVING.
- Honor the "fabrication permitted in total mode" rule — JD-required tools,
  domain claims, and plausible metrics MAY be added when adjacent experience
  doesn't exist. Just do not surface any [FABRICATED] tag in the output text.
- All Prohibited Actions remain prohibited EXCEPT the ones the skill explicitly
  unlocks under total mode.
- Domain reframes for missing JD domains: apply them; do not print the rationale.
- Reorder roles, sections, and skill categories to lead with JD-relevant content.

--- TECH SWAPS ---
For each entry in JUDGE_JSON.tailoring_hints.tech_swaps, replace "from" with "to"
everywhere in the resume (skills, bullets, summary). Replace the technology name only.
If target_role is present, apply that swap ONLY inside the matching employer section.
If target_role is null or missing, apply it unscoped (current behavior).

--- SKILLS SECTION ATOMICITY (NON-NEGOTIABLE) ---

The SKILLS section is LOCKED to the canonical resume's SKILLS content.

You MAY:
  - Reorder skill categories (e.g. lead with Backend when the JD is backend-heavy).
  - Reorder skills within a category to lead with JD-relevant ones.

You MAY NOT, under any circumstance:
  - Add a skill, tool, framework, language, or library that is not in the
    canonical SKILLS section.
  - Remove any skill from the canonical SKILLS section.
  - Move skills between categories (Cypress is not Backend; do not relocate).

This rule applies even when JUDGE_JSON.gap_directives requests adding a tool
via handling="fabricate". Fabricate directives apply ONLY to Experience bullets,
NEVER to the SKILLS section.

If a JD requires a tool that is not in the candidate's canonical SKILLS, surface
it through an Experience bullet reframe at the role indicated by the relevant
gap_directive's target_role — never by adding it to SKILLS.

--- LENGTH CONSTRAINT ---
Word count of the rendered text (ignoring LaTeX commands): between 1900 and 2500.
Do NOT summarize. Do NOT shorten. Do NOT remove bullets or projects for any
reason, including:
- The JD having few required skills (you do not get to decide which canonical
  content is "less relevant" when the JD is narrow — keep all of it).
- The JD focusing on a specific domain (e.g., a backend-only role — Flutter
  bullets and AI tooling still stay; reorder them down, do not remove).
- A perceived need to "tighten" the resume to look more focused.

If the canonical is at 1959 words, the tailored version should stay in the same
neighborhood or longer. Adding bullets to incorporate JD-required tech is
expected. Removing canonical bullets is FORBIDDEN.

--- LATEX SAFETY ---
- Escape special characters in content correctly: %, &, $, _, #
- Use \\textbackslash{}, \\textasciitilde{}, \\textasciicircum{} where literal
  versions are needed.
- Keep all \\begin{...} and \\end{...} pairs balanced.
- Do not introduce new LaTeX environments or packages.
========================================================================
`.trim();

export const TOTAL_MODE_PROMPT = `${skillContent}\n\n${PIPELINE_OVERRIDE}`;

export const PROMPT_SHA = crypto
  .createHash("sha256")
  .update(TOTAL_MODE_PROMPT, "utf8")
  .digest("hex")
  .slice(0, 12);

export function renderResumeGapDirectives(directives: GapDirective[] | undefined): string {
  if (!directives || directives.length === 0) return "";

  const fabricateOrReframe = directives.filter(d =>
    d.handling === "fabricate" || d.handling === "reframe",
  );
  const forbid = directives.filter(d => d.handling === "forbid");

  if (fabricateOrReframe.length === 0 && forbid.length === 0) return "";

  let out = "\n=== JUDGE GAP DIRECTIVES (apply to the resume) ===\n";

  for (const d of fabricateOrReframe) {
    out += `\n[${d.handling.toUpperCase()}] ${d.jd_requirement}`;
    if (d.target_role) out += `\n  -> at role: ${d.target_role}`;
    if (d.frame_as) out += `\n  -> frame as: ${d.frame_as}`;
  }

  if (forbid.length > 0) {
    out += "\n\n[FORBIDDEN -- never claim these in any bullet]\n";
    for (const d of forbid) out += `  - ${d.jd_requirement}\n`;
  }

  return out;
}

export function renderResumeScopedTechSwaps(swaps: TechSwap[] | undefined): string {
  if (!swaps || swaps.length === 0) return "";

  let out = "\n=== JUDGE TECH SWAPS (resume scope) ===\n";
  for (const swap of swaps) {
    out += `\n- ${swap.from} -> ${swap.to}`;
    if (swap.target_role) {
      out += ` (apply only at role: ${swap.target_role})`;
    } else {
      out += " (apply anywhere if relevant)";
    }
  }
  return out;
}

export function renderResumeJudgeAddendum(
  directives: GapDirective[] | undefined,
  swaps: TechSwap[] | undefined,
): string {
  return `${renderResumeScopedTechSwaps(swaps)}${renderResumeGapDirectives(directives)}`.trim();
}
