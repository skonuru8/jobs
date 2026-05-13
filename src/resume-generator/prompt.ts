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

let _skillContent: string | null = null;

function readSkill(): string {
  if (_skillContent) return _skillContent;
  if (!fs.existsSync(SKILL_PATH)) {
    throw new Error(`Resume tailor skill missing (operator error): ${SKILL_PATH}`);
  }
  _skillContent = fs.readFileSync(SKILL_PATH, "utf8");
  return _skillContent;
}

export const TOTAL_MODE_PROMPT = `${readSkill()}

---

ADDITIONAL INSTRUCTIONS FOR PIPELINE USE:
- You are operating in TOTAL mode. No approval round.
- Apply all changes you decide on.
- The output MUST be valid LaTeX matching the canonical resume's exact document class, packages, and structure.
- Output ONLY the full LaTeX document. No commentary, no markdown fences, no CHANGES_MADE block, no preamble, no afterword.
- The first character of your response must be \\documentclass and the last non-whitespace token must be \\end{document}.
- Word count target: between 1900 and 2500 words. Do not summarize. Do not shorten.
`.trim();

export const PROMPT_SHA = crypto
  .createHash("sha256")
  .update(TOTAL_MODE_PROMPT, "utf8")
  .digest("hex")
  .slice(0, 12);
