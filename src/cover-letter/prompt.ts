/**
 * prompt.ts — system prompt and user prompt builder for cover letter generation.
 */

import * as crypto from "crypto";

import type { GapDirective, TechSwap } from "@/judge/types";
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
- Output must be safe for LaTeX: avoid %, &, $, _, #, ~, ^, \\. Use plain text alternatives.

STRUCTURE (4 paragraphs, target 400-550 words; absolute minimum 350):
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
- Confident, direct, specific numbers; never vague
- No hedging: replace "I believe", "I think", "I feel" with "I bring", "I have", "I deliver"
- Match the JD's vocabulary where natural
- Do NOT fabricate metrics. Only use metrics that appear in the canonical resume.

PUNCTUATION RULE (NON-NEGOTIABLE):
- NEVER use em-dashes or en-dashes anywhere in your output.
- Do not output LaTeX "---" or "--".
- Do not output Unicode U+2014 or U+2013.
- Use commas, periods, parentheses, or rewrite the sentence.
- Single hyphens in hyphenated words are fine.`;

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
    ? `${job.yoe_min ?? "?"} to ${job.yoe_max ?? "?"} years`
    : "not specified";

  const respLines = job.responsibilities.length
    ? job.responsibilities.map((r, i) => `  ${i + 1}. ${r}`).join("\n")
    : "  not extracted";

  const skillsQuality = job.score_components.skills >= 0.75
    ? "strong direct match"
    : job.score_components.skills >= 0.55
    ? "solid partial match"
    : "semantic match, some gaps";

  const swapsBlock = renderSwapsBlock(input.tech_swaps);
  const fabricatedClaimsBlock = renderFabricatedClaimsBlock(input.gap_directives);
  const resumeSection = input.experience_block?.trim()
    ? `=== CANDIDATE EXPERIENCE (verbatim from resume) ===
This block is reference material. Do not reorder bullets, do not reorder employers, do not move bullets or metrics between employers. Quote selectively when narrating.

${input.experience_block.trim()}

=== EMPLOYER ATTRIBUTION RULES (NON-NEGOTIABLE) ===

1. The CANDIDATE EXPERIENCE block above lists each employer's bullets verbatim
   from the canonical resume. That is the baseline truth for what each
   employer used.

2. The tailored resume for this job has already been generated and may have
   applied Mode B tech_swaps to align with the JD. When narrating about an
   employer, use the post-swap tech names. The cover letter must agree with
   the tailored resume that the recruiter will read alongside it.

3. The active tech_swaps for this job are listed below under ACTIVE_TECH_SWAPS.
   For each swap with target_role = "<Employer>", when you write about that
   employer's work, use the "to" technology, not the "from" technology. If
   target_role is null, the swap applies everywhere that tech is mentioned.

4. NEVER move real bullets, accomplishments, or metrics from one employer to another. If a Hitachi bullet describes a decomposition that restored 7 min to 1 min, do not retell that accomplishment under AquilaEdge. This rule applies to canonical-resume content only. Claims listed under FABRICATED CLAIMS THE RESUME HAS MADE are bound to their declared target_role by the resume itself; mirroring them at that target_role is consistent, not cross-attribution.

5. If you do not name an employer, use neutral framing ("in a prior role",
   "in a recent engagement"). Whatever tech you mention must come from a
   single real role, with active swaps applied.

6. Do not switch employers inside the same paragraph. One employer per
   paragraph; start a new paragraph for a different employer or use neutral
   framing.

=== ACTIVE_TECH_SWAPS (apply to narration) ===

${swapsBlock || "(none)"}

=== FABRICATED CLAIMS THE RESUME HAS MADE ===

${fabricatedClaimsBlock || "(none)"}

When the cover letter mentions a fabricated claim's target_role, you MAY
reference the claim using the framing the resume used. You MAY also choose not
to mention it. What you MUST NOT do is contradict it.

=== STYLE GUARD (applies to cover letter body) ===

The same style rules that govern the tailored resume apply here:
  - No bridging phrases ("demonstrating transferable skills", "analogous to",
    "similar to <JD tech>", "akin to", "whose syntax is nearly identical to",
    "foundational knowledge of", "exposure to" when claiming proficiency).
  - No two-stack-in-one-sentence patterns with hedges.
  - No JD-targeting tails.
  - No gap confessions.

The cover letter should read as natural professional prose. If a sentence
reads like an AI-generated tailoring move, rewrite it.`
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
Assert competence only through closest supported experience from the resume. Never confess gaps.`
    : "All required skills present on resume. No bridging needed.";

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
  Visa:            ${visaSummary}${job.visa_quote ? `, quote: "${job.visa_quote}"` : ""}

ROLE RESPONSIBILITIES:
${respLines}

REQUIRED SKILLS (job):
${job.required_skills.map(s => `  ${s.name} (${s.importance}${s.years_required ? `, ${s.years_required}yr` : ""})`).join("\n") || "  not extracted"}

CANDIDATE SKILLS MATCHED TO THIS JOB: ${matchedSkills.join(", ") || "none matched by name, use semantic overlap"}
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
    lines.push("[ACKNOWLEDGE, address these honestly in the body]");
    for (const d of acknowledge) {
      lines.push(`- ${d.jd_requirement} -> frame as: ${d.frame_as ?? ""}`.trimEnd());
    }
    lines.push("");
  }

  if (fabricate.length > 0) {
    lines.push("[SILENTLY FABRICATE, incorporate into claims without flagging the gap]");
    for (const d of fabricate) {
      const at = d.target_role ? `, at: ${d.target_role}` : "";
      lines.push(`- ${d.jd_requirement}${at}, frame as: ${d.frame_as ?? ""}`);
    }
    lines.push("");
  }

  if (forbid.length > 0) {
    lines.push("[FORBIDDEN, never claim these]");
    for (const d of forbid) {
      lines.push(`- ${d.jd_requirement}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

export function renderSwapsBlock(swaps: TechSwap[] | undefined): string {
  if (!swaps?.length) return "";
  return swaps.map(s => {
    const where = s.target_role ? `at "${s.target_role}"` : "(unscoped)";
    return `  - "${s.from}" -> "${s.to}" ${where}`;
  }).join("\n");
}

export function renderFabricatedClaimsBlock(directives: GapDirective[] | undefined): string {
  const fabs = (directives ?? []).filter(d => d.handling === "fabricate");
  if (!fabs.length) return "";
  return fabs.map(d => {
    const role = d.target_role ?? "(unscoped)";
    const frame = d.frame_as ?? d.jd_requirement;
    return `  - ${role}: "${frame}"`;
  }).join("\n");
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
