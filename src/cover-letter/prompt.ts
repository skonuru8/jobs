/**
 * prompt.ts — system prompt and user prompt builder for cover letter generation.
 */

import * as crypto from "crypto";

import type { GapDirective } from "@/judge/types";
import type { CoverLetterInput } from "./types";

export const PROMPT_VERSION = "pipeline-tex-v2";

export const COVER_LETTER_SYSTEM = `You are writing the body of a professional cover letter for a job application.

OUTPUT FORMAT:
- Output ONLY the prose body — the paragraphs between "Dear Hiring [X]," and "Sincerely,"
- Do NOT include the greeting line ("Dear Hiring Manager," etc.)
- Do NOT include the sign-off ("Sincerely," / name / etc.)
- Do NOT include a header, address block, date, or "Re:" line
- Do NOT include metadata, frontmatter, footnotes, or commentary
- Do NOT use markdown formatting (no **, ##, etc.) — output plain prose paragraphs
- Separate paragraphs with a single blank line
- Output must be safe for LaTeX: avoid %, &, $, _, #, ~, ^, \\ — use plain text alternatives

STRUCTURE (4 paragraphs, 400-550 words total. UNDER 400 WORDS IS A FAILURE):
Count words before output. If the body is under 400 words, add a fourth paragraph that either:
  - addresses the strongest judge.gaps[].reframe_angle in depth, OR
  - expands on why_apply with a specific company-relevant detail from the JD
Do not pad with generic filler. Do not repeat earlier paragraphs.
1. Opening: "I am writing to apply for [role] at [company]" + one positioning sentence (years of experience + 3-4 key technologies from the JD that match the canonical resume)
2. Strongest relevant past experience with specific metrics from the canonical resume only (e.g., 85% reduction, 55% latency improvement, 100+ GB telemetry) mapped to JD requirements
3. Second relevant experience or a company/role-specific hook (the company's domain, mission, or stated values from the JD)
4. Closing: location/availability fit, education (M.S. CS from Stevens), closing offer to discuss

TECH SWAPS:
If judge.tailoring_hints.tech_swaps is non-empty, apply those swaps when referencing
technologies. Replace each "from" skill with the corresponding "to" skill everywhere
it appears. This is a Mode B substitution — no surrounding word changes. If a swap
has target_role, keep that substitution scoped to the matching employer only.

STYLE:
- Confident, direct, specific numbers — never vague
- No hedging: replace "I believe", "I think", "I feel" with "I bring", "I have", "I deliver"
- Match the JD's vocabulary where natural
- Do NOT fabricate metrics. Only use metrics that appear in the canonical resume.`;

export const COVER_PROMPT_SHA = crypto
  .createHash("sha256")
  .update(COVER_LETTER_SYSTEM, "utf8")
  .digest("hex")
  .slice(0, 12);

/** @deprecated use COVER_LETTER_SYSTEM */
export const SYSTEM_PROMPT = COVER_LETTER_SYSTEM;

export function appendStructuredJsonSections(
  narrativePrompt: string,
  jd: Record<string, unknown>,
  judge: Record<string, unknown>,
  profile: unknown,
): string {
  return [
    narrativePrompt,
    "",
    "--- JD_JSON ---",
    JSON.stringify(jd, null, 2),
    "",
    "--- JUDGE_JSON ---",
    JSON.stringify(judge, null, 2),
    "",
    "--- PROFILE_JSON ---",
    JSON.stringify(profile, null, 2),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// User prompt builder (structured narrative + JSON attachments)
// ---------------------------------------------------------------------------

export function buildCoverLetterPrompt(input: CoverLetterInput): string {
  const { job, profile, resume } = input;

  const expertSkills = profile.skills
    .filter(s => s.confidence === "expert")
    .map(s => `${s.name} (${s.years}yr)`);
  const strongSkills = profile.skills
    .filter(s => s.confidence === "strong")
    .map(s => `${s.name} (${s.years}yr)`);

  const profileSkillSet = new Set(profile.skills.map(s => s.name.toLowerCase()));
  const matchedSkills = job.required_skills
    .filter(s => s.importance === "required" || s.importance === "preferred")
    .filter(s => profileSkillSet.has(s.name.toLowerCase()))
    .map(s => s.name)
    .slice(0, 10);

  const missingRequired = job.required_skills
    .filter(s => s.importance === "required")
    .filter(s => !profileSkillSet.has(s.name.toLowerCase()))
    .map(s => s.name);

  const yoe = (job.yoe_min !== null || job.yoe_max !== null)
    ? `${job.yoe_min ?? "?"}–${job.yoe_max ?? "?"} years`
    : "not specified";

  const respLines = job.responsibilities.length
    ? job.responsibilities.map((r, i) => `  ${i + 1}. ${r}`).join("\n")
    : "  not extracted";

  const skillsQuality = job.score_components.skills >= 0.75
    ? "strong direct match"
    : job.score_components.skills >= 0.55
    ? "solid partial match"
    : "semantic match — some gaps";

  const resumeSection = input.experience_block?.trim()
    ? `=== CANDIDATE EXPERIENCE (verbatim from resume — do not reorganize) ===

${input.experience_block.trim()}

=== EMPLOYER ATTRIBUTION RULES (NON-NEGOTIABLE) ===

1. When you describe work done at a specific employer (e.g., "at AquilaEdge",
   "at Hitachi Vantara", "in my Nokia CPQ engagement"), every technology, metric,
   and outcome in that sentence must come from THAT employer's bullets above.

2. NEVER attribute work from one employer to another. Examples of forbidden mixing:
   - Saying "at AquilaEdge I led the decomposition" when the decomposition is
     under Hitachi Vantara / Nokia CPQ.
   - Saying "at AquilaEdge I used Java and Spring Boot" when AquilaEdge's bullets
     show only Node.js, Flutter, and GCP.
   - Saying "most recent role as Consultant (Jul 2019 – Mar 2024)" when the most
     recent role above is at AquilaEdge (Jan 2025 – Jun 2025).

3. If you don't name an employer, use neutral framing like "in a prior role" or
   "in a recent engagement" — but the metrics and tech in that sentence must still
   come from a single real role above.

4. AquilaEdge's stack is Node.js + Flutter + GCP + Google Cloud SQL. Period.
   Nokia/Hitachi's stack is Java + Spring Boot + Azure (Service Bus, Cosmos DB)
   + Redis. Period. Do not blur these.

5. Do NOT switch employers inside the same paragraph after naming one. If you
   want to discuss a different employer, start a new paragraph for that employer
   or use neutral framing with no employer name.`
    : resume?.trim()
    ? `CANONICAL RESUME (LaTeX or text — metrics must match this source only):\n${resume.trim()}`
    : `CANONICAL RESUME: Not provided. Use profile skills only; do not invent metrics.`;

  // Pull verbatim phrasing from profile. Generator inserts as-is, no rewording.
  const verbatim = profile.work_authorization.requires_sponsorship
    ? profile.work_authorization.cover_letter_phrasing_sponsorship_needed
    : profile.work_authorization.cover_letter_phrasing_no_sponsorship_needed;

  let visaNote: string;
  if (job.visa_sponsorship === "denied") {
    // Job explicitly refused sponsorship. Do not discuss authorization.
    visaNote = "Do not mention work authorization, visa, or sponsorship anywhere in the letter.";
  } else if (verbatim && verbatim.trim().length > 0) {
    // Insert user-authored sentence verbatim. No rewording.
    visaNote =
      `In the closing paragraph, include the following sentence VERBATIM. ` +
      `Do not rephrase, summarize, expand, or modify it in any way. ` +
      `Copy character-for-character:\n\n"${verbatim.trim()}"`;
  } else {
    // No user-authored phrasing. Stay silent.
    visaNote = "Do not mention work authorization, visa, or sponsorship.";
  }

  const gapNote = missingRequired.length > 0
    ? `SKILLS NOT EXPLICITLY ON RESUME (required by job): ${missingRequired.join(", ")}
Assert competence through closest analogous experience from the resume — never confess gaps.`
    : "All required skills present on resume — no bridging needed.";

  const concernsNote = job.judge_concerns?.length
    ? `Judge concerns (context only — never quote as metadata in the letter body):\n${job.judge_concerns.map(c => `  - ${c}`).join("\n")}`
    : "Concerns: none";

  const gapDirectivesSection = renderCoverLetterGapDirectives(input.gap_directives);
  const visaSummary = (() => {
    switch (job.visa_sponsorship) {
      case "offered": return "sponsorship offered";
      case "denied": return "sponsorship denied";
      case "ead_eligible": return "EAD/OPT/H-1B eligible";
      case "payment_model_only": return "payment model restriction only";
      case "unmentioned": return "not mentioned";
    }
  })();

  return `Write the cover letter BODY for the following application (no greeting or sign-off).

TARGET JOB:
  Title:           ${job.title}
  Company:         ${job.company}
  Domain:          ${job.domain ?? "not specified"}
  Employment type: ${job.employment_type ?? "not specified"}
  YOE required:    ${yoe}
  Visa:            ${visaSummary}${job.visa_quote ? ` — quote: "${job.visa_quote}"` : ""}

ROLE RESPONSIBILITIES:
${respLines}

REQUIRED SKILLS (job):
${job.required_skills.map(s => `  ${s.name} (${s.importance}${s.years_required ? `, ${s.years_required}yr` : ""})`).join("\n") || "  not extracted"}

CANDIDATE SKILLS MATCHED TO THIS JOB: ${matchedSkills.join(", ") || "none matched by name — use semantic overlap"}
SKILLS QUALITY SIGNAL: ${skillsQuality}

${gapNote}

CANDIDATE PROFILE:
  Expert skills: ${expertSkills.join(", ") || "none listed"}
  Strong skills: ${strongSkills.join(", ") || "none listed"}
  Total YOE:     ${profile.years_experience} years
  Education:     ${profile.education.degree} in ${profile.education.field}
  Domains:       ${profile.preferred_domains.join(", ")}

${resumeSection}

${gapDirectivesSection}

JUDGE REASONING (themes to echo, not to paste verbatim):
${job.judge_reasoning ?? "Strong skill and seniority alignment."}

${concernsNote}

VISA INSTRUCTION: ${visaNote}`;
}

export function renderCoverLetterGapDirectives(directives: GapDirective[] | undefined): string {
  if (!directives || directives.length === 0) return "";

  const acknowledge = directives.filter(d => d.handling === "acknowledge");
  const fabricate = directives.filter(d => d.handling === "fabricate");
  const forbid = directives.filter(d => d.handling === "forbid");

  if (acknowledge.length === 0 && fabricate.length === 0 && forbid.length === 0) return "";

  const lines = ["=== JUDGE GAP DIRECTIVES (apply to the cover letter) ===", ""];

  if (acknowledge.length > 0) {
    lines.push("[ACKNOWLEDGE -- address these honestly in the body]");
    for (const d of acknowledge) {
      lines.push(`- ${d.jd_requirement} -> frame as: ${d.frame_as ?? ""}`.trimEnd());
    }
    lines.push("");
  }

  if (fabricate.length > 0) {
    lines.push("[SILENTLY FABRICATE -- incorporate into claims without flagging the gap]");
    for (const d of fabricate) {
      const at = d.target_role ? `, at: ${d.target_role}` : "";
      lines.push(`- ${d.jd_requirement}${at}, frame as: ${d.frame_as ?? ""}`);
    }
    lines.push("");
  }

  if (forbid.length > 0) {
    lines.push("[FORBIDDEN -- never claim these]");
    for (const d of forbid) {
      lines.push(`- ${d.jd_requirement}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

export function extractTitleKeywords(title: string): string[] {
  const stopWords = new Set([
    "senior", "junior", "staff", "principal", "lead", "engineer", "developer",
    "architect", "manager", "director", "vice", "president", "assistant", "avp",
    "vp", "the", "and", "or", "of", "for", "with", "a", "an",
  ]);
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w))
    .slice(0, 4);
}
