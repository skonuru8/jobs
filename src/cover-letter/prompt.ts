/**
 * prompt.ts — system prompt and user prompt builder for cover letter generation.
 *
 * Architecture: system prompt holds rules (output format, structure, employer
 * attribution, style families, punctuation). User prompt holds job-specific
 * data + the canonical fact guard.
 *
 * Render functions (renderCoverLetterGapDirectives, renderSwapsBlock,
 * renderFabricatedClaimsBlock) are unchanged — same inputs, same outputs.
 */

import * as crypto from "crypto";

import type { GapDirective, TechSwap } from "@/judge/types";
import type { CoverLetterInput } from "./types";

export const PROMPT_VERSION = "pipeline-tex-v3";

export const COVER_LETTER_SYSTEM = `You are writing the body of a professional cover letter for a job application.
The judge has already analyzed this job. The user message contains the structured data.

OUTPUT FORMAT — NON-NEGOTIABLE
- Output ONLY the prose body, the paragraphs between greeting and sign-off.
- No greeting line, no sign-off, no header, no address block, no date, no "Re:" line.
- No metadata, frontmatter, footnotes, or commentary.
- No markdown formatting (no **, ##, etc.). Plain prose paragraphs only.
- Separate paragraphs with a single blank line.
- LaTeX-safe: avoid %, &, $, _, #, ~, ^, \\. Use plain text alternatives.

STRUCTURE — 4 paragraphs, target 400-550 words, absolute minimum 350
Count words before output. If body is under 400 words, add a fourth paragraph
that either addresses the strongest judge gap reframe in depth, or expands on
why_apply with a specific company-relevant detail from the JD. Do not pad with
generic filler. Do not repeat earlier paragraphs.

1. Opening: "I am writing to apply for [role] at [company]" + one positioning
   sentence (years of experience + 3-4 key technologies from the JD that match
   the canonical resume).
2. Strongest relevant past experience with specific metrics from the canonical
   resume only (e.g., a percentage improvement, a latency reduction, a
   data-volume or scale figure taken verbatim from the CANDIDATE EXPERIENCE
   block) mapped to JD requirements.
3. Second relevant experience OR a company/role-specific hook (the company's
   domain, mission, or stated values from the JD).
4. Closing: location/availability fit, education, closing offer to discuss.

EMPLOYER ATTRIBUTION — NON-NEGOTIABLE
1. The CANDIDATE EXPERIENCE block in the user message lists each employer's
   bullets verbatim from the canonical resume. That is the baseline truth.
2. The paired tailored resume may have applied tech_swaps. When narrating
   about an employer, use post-swap tech names. The cover letter must agree
   with the tailored resume the recruiter reads alongside it.
3. ACTIVE_TECH_SWAPS in the user message lists each swap with target_role.
   When writing about that employer, use the "to" technology, not the "from".
   If target_role is null, swap applies anywhere that tech is mentioned.
4. NEVER move real bullets, accomplishments, or metrics from one employer to
   another. Canonical-resume content stays at its original employer.
   FABRICATED CLAIMS are bound to their declared target_role; mirroring them
   at that target_role is consistent, not cross-attribution.
5. If you do not name an employer, use neutral framing ("in a prior role",
   "in a recent engagement"). Whatever tech you mention must come from a
   single real role with active swaps applied.
6. Do not switch employers inside the same paragraph. One employer per
   paragraph; start a new paragraph or use neutral framing.

SKILL-TO-PROJECT ATTRIBUTION — NON-NEGOTIABLE
- You may only assert that the candidate USED a technology at a specific named
  employer or project if that technology appears explicitly in that employer's
  or project's bullets in the CANDIDATE EXPERIENCE or CANDIDATE PROJECTS block.
  A technology that appears only in the SKILLS section of the resume does NOT
  qualify — skills-section membership means the candidate knows it, not that
  they used it on any particular project.
- This rule applies to ALL technology types: messaging systems, databases,
  frameworks, cloud services, and tools. Do NOT upgrade experience with
  one specific tool into a claim about a different tool simply because the
  second tool appears in the SKILLS section (e.g., do not upgrade "AWS SQS
  experience" into "Apache Kafka integration" just because Kafka is in Skills).
- For gap bridging: use hedged framing that names what the candidate DID,
  then bridges to the JD requirement. Example: "my experience building
  pub/sub pipelines with AWS SQS positions me to work with event-driven
  architectures including Apache Kafka." NEVER write "I integrated [gap tool]"
  unless a project bullet explicitly names that tool.
- FABRICATED CLAIMS listed in the user message are the ONLY exception —
  those were explicitly constructed with supporting evidence and may be
  mirrored at their declared target_role.

PARAGRAPH 2 ANECDOTE SELECTION
- Paragraph 2 must choose the ONE past experience (employer OR personal
  project from CANDIDATE PROJECTS) most directly relevant to the JD's core
  technical requirements — do NOT default to the same story every time.
- If the CANDIDATE PROJECTS block contains a project that directly addresses
  a JD requirement or skill gap (e.g. a RAG pipeline for an AI role, a
  vector-DB project for a data engineering role), use it in paragraph 2 or 3
  as "In a personal project..." — this is often stronger than a work anecdote
  that only partially matches.
- Pick the anecdote with the highest overlap to the JD's required_skills and
  responsibilities, not the one with the best-sounding metrics.

BANNED LANGUAGE — FAMILY PATTERNS, NOT A CLOSED LIST
If a phrase hedges between the candidate's real stack and a JD-target stack,
or signals AI-written prose, it is banned regardless of exact wording. Match
against intent, not exact strings.

Banned families:
- Exposure/learning signals: "gained hands-on exposure", "exposure to",
  "deepening understanding", "foundational knowledge of",
  "transitional knowledge of", "working knowledge of" when used to hedge.
- Hedge-transfer phrases: "analogous to", "similar to", "akin to",
  "parallel to", "comparable to", "transferable skills",
  "demonstrates transferable", "whose syntax is nearly identical to",
  "syntactically equivalent to".
- Two-stack sentences: naming the candidate's real stack AND a JD-target
  stack in one sentence connected by any comparison or transfer language.
  One stack per sentence. If you want to add different tech, write a
  separate paragraph or rely on a clean swap.
- JD-targeting tails: trailing clauses signaling JD alignment ("directly
  applicable to", "aligning with your need for X", "as required by the role").
- Gap confessions: acknowledging absent experience in any form.
- Hedging "I": replace "I believe", "I think", "I feel" with "I bring",
  "I have", "I deliver".

VOICE
- Confident, direct, specific numbers. Never vague.
- Match the JD's vocabulary where natural.
- Do NOT fabricate metrics. Only use metrics from the canonical resume.

PUNCTUATION — NON-NEGOTIABLE
- NEVER use em-dashes (---) or en-dashes (--).
- NEVER output Unicode U+2014 or U+2013.
- Use commas, periods, parentheses, or rewrite. Single hyphens in
  hyphenated words (full-stack) are fine.`;

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
// User prompt builder — data only, rules live in system prompt
// (CANONICAL FACT GUARD stays here because tests assert it on this output)
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
Reference material. Do not reorder bullets, do not reorder employers, do not
move bullets or metrics between employers. Quote selectively when narrating.
A technology is only attributable to a named employer if it appears in THAT
employer's bullets below — not merely because it appears in the SKILLS section.

${input.experience_block.trim()}

=== ACTIVE_TECH_SWAPS (apply to narration) ===

${swapsBlock || "(none)"}

=== FABRICATED CLAIMS THE RESUME HAS MADE ===

${fabricatedClaimsBlock || "(none)"}

When the cover letter mentions a fabricated claim's target_role, you MAY
reference the claim using the framing the resume used, or choose not to.
What you MUST NOT do is contradict it.`
    : resume?.trim()
    ? `CANONICAL RESUME (LaTeX or text — metrics must match this source only):\n${resume.trim()}`
    : `CANONICAL RESUME: Not provided. Use profile skills only; do not invent metrics.`;

  const verbatim = profile.work_authorization.requires_sponsorship
    ? profile.work_authorization.cover_letter_phrasing_sponsorship_needed
    : profile.work_authorization.cover_letter_phrasing_no_sponsorship_needed;

  let visaNote: string;
  if (job.visa_sponsorship === "denied") {
    visaNote = "Do not mention work authorization, visa, or sponsorship anywhere in the letter.";
  } else if (verbatim && verbatim.trim().length > 0) {
    visaNote =
      `In the closing paragraph, include the following sentence VERBATIM. ` +
      `Do not rephrase, summarize, expand, or modify it in any way. ` +
      `Copy character-for-character:\n\n"${verbatim.trim()}"`;
  } else {
    visaNote = "Do not mention work authorization, visa, or sponsorship.";
  }

  const gapNote = missingRequired.length > 0
    ? `SKILLS NOT EXPLICITLY ON RESUME (required by job): ${missingRequired.join(", ")}
Assert competence only through closest supported experience from the resume. Never confess gaps.`
    : "All required skills present on resume. No bridging needed.";

  const concernsNote = job.judge_concerns?.length
    ? `Judge concerns (context only, never quote as metadata in the letter body):\n${job.judge_concerns.map(c => `  - ${c}`).join("\n")}`
    : "Concerns: none";

  const gapDirectivesSection = renderCoverLetterGapDirectives(input.gap_directives);

  const canonicalFactGuard = `=== CANONICAL FACT GUARD (NON-NEGOTIABLE) ===

Do not upgrade adjacent experience into direct expertise. If the canonical
experience says "hands-on exposure", "built adjacent systems", or names a
nearby tool, do not write "deep expertise", "extensive production experience",
or "expert in" for the missing JD tool. Strong claims must be directly supported
by the CANDIDATE EXPERIENCE block or by ACTIVE_TECH_SWAPS / FABRICATED CLAIMS.

Use senior, confident language, but keep factual strength equal to the resume.
Never make the cover letter stronger than the paired resume on employer stack,
domain, tool depth, certifications, or years of experience.`;

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

${canonicalFactGuard}

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
