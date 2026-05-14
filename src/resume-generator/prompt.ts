/**
 * prompt.ts — loads skills/resume-tailor/SKILL.md and builds TOTAL_MODE_PROMPT.
 */

import * as crypto from "crypto";
import * as fs     from "fs";
import * as path   from "path";
import { fileURLToPath } from "url";

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
- Honor the "fabrication permitted in total mode" rule — JD-required tools,
  domain claims, and plausible metrics MAY be added when adjacent experience
  doesn't exist. Just do not surface any [FABRICATED] tag in the output text.
- All Prohibited Actions remain prohibited EXCEPT the ones the skill explicitly
  unlocks under total mode.
- Domain reframes for missing JD domains: apply them; do not print the rationale.
- Reorder roles, sections, and skill categories to lead with JD-relevant content.

--- TECH SWAPS ---
If JUDGE_JSON contains tailoring_hints.tech_swaps with entries, apply those swaps across
the canonical resume content. Replace each "from" value with the corresponding "to" value
everywhere it appears (Skills section, bullets, summary). This is a Mode B substitution —
no surrounding word changes, replace only the technology name itself.

--- LENGTH CONSTRAINT ---
Word count of the rendered text (ignoring LaTeX commands): between 1900 and 2500.
Do NOT summarize. Do NOT shorten. If the canonical is at 1959 words, the tailored
version should stay in the same neighborhood. Adding bullets to incorporate
JD-required tech is expected; trimming bullets to "tighten" is forbidden.

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
