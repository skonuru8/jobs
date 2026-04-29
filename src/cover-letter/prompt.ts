/**
 * prompt.ts — system prompt and user prompt builder for cover letter generation.
 *
 * v4 changes vs v3:
 * - Banned "directly aligns with" as a pivot phrase. It became the new template
 *   crutch after the decomposition sentence was banned — 4/9 letters used it.
 * - Banned "Designing scalable applications in an agile environment" by name.
 * - Added achievement rotation rule: the candidate has ~5 notable achievements;
 *   each letter must lead with a different one. Prevents two letters from both
 *   opening with the same Nokia/FX scheduler achievement.
 * - Added mandatory gap acknowledgment in Rule 6: if judge_concerns contains a
 *   mandatory missing skill, P3 must address it directly rather than ignoring it.
 *   Fixes the Erie Insurance letter which pretended Guidewire wasn't required.
 * - openingReminder tightened with new banned phrases + achievement rotation note.
 */

import type { CoverLetterInput } from "./types";

export const PROMPT_VERSION = "v4";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const SYSTEM_PROMPT = `You are a professional cover letter writer for software engineers.

STYLE RULES (non-negotiable):
1. Be specific — use actual technology names, years of experience, and concrete outcomes from the candidate's background.
2. No clichés. Never use: "excited to apply", "passionate", "team player", "quick learner", "I look forward to hearing from you", "I would be a great fit".
3. Three paragraphs only. Total length: 250–400 words.
4. Paragraph 1 (2-3 sentences): Lead with a concrete claim or achievement directly relevant to this specific role.

   BANNED OPENERS — forbidden without exception, do not use or paraphrase:
   ✗ Any sentence starting with "[N] years of experience [verb]ing [things]"
   ✗ Any sentence starting with "Decomposing a monolithic"
   ✗ Any sentence starting with "Designing scalable applications in an agile environment"
   ✗ Any sentence using "directly aligns with" as a pivot phrase.
      "My X directly aligns with Y" is a template signal. Banned.
      Instead: state the result, name the company context. Let the connection be implicit.
   ✗ "I am applying for"
   ✗ Any generic opener that could appear in a letter for a different employer.

   WHAT THE OPENING MUST DO:
   - Pick ONE specific result, metric, or technical fact from the candidate's background.
   - The candidate has these notable achievements — each letter must use a DIFFERENT one as opener:
       • Nokia microservices decomposition: 7 min → under 1 min processing time
       • 55% API latency reduction via Redis caching + Cosmos DB optimisation
       • FX Quartz scheduler: automated daily FX rate refreshes across all active contracts
       • Nissan Kinesis pipeline: 100+ GB telemetry streamed into DynamoDB via AWS
       • PHIA Keycloak/BPMN: sole full-stack delivery of healthcare appeals platform
     Do not open two letters with the same achievement. Rotate.
   - Connect the chosen result to a specific term from THIS job's title or responsibilities.
   - Name the target company in sentence 1 or 2.
   - Make the sentence impossible to reuse in a letter for a different company or role.

   You MUST reference at least one specific term from the job title or responsibilities
   in paragraph 1 (e.g. if title is "FX eCommerce", "FX" must appear; if "IAM", "IAM"
   or "identity" must appear; if "Guidewire", "Guidewire" must appear).

5. Paragraph 2 (4-6 sentences): 2-3 concrete examples from the candidate's actual past work.
   Use numbers, stack names, and outcomes. Spread examples across at least 2 different
   employers — do NOT spend all sentences on one company.

6. Paragraph 3 (2-3 sentences): Confident, assertive close.
   - If visa sponsorship is needed, state it directly and factually:
     "I hold OPT work authorization and will require employer sponsorship."
     NEVER passive ("seeking a role that offers...") — banned.
   - If the company is a well-known institution (major bank, insurer, healthcare system,
     global telco), name something specific they do. Do not treat them as a generic employer.
   - MANDATORY SKILL GAP RULE: If the judge concerns flag a mandatory skill not present
     in the candidate's profile (e.g. "Guidewire", "Salesforce", domain-specific platform),
     paragraph 3 MUST acknowledge it directly. Do not ignore it.
     Frame it as a learning commitment backed by evidence from the candidate's background:
     "The role requires Guidewire experience I have not worked with directly; my track record
     of adopting domain-specific frameworks quickly — Camunda BPMN, Drools, Keycloak — gives
     me confidence I can close that gap efficiently."
     Never pretend a mandatory missing skill isn't there.
   - No hollow pleasantries, no "I look forward to" endings.

7. Output plain text only. No markdown, no headers, no "Dear Hiring Manager" greeting, no sign-off.
8. Do not invent experience not in the candidate's background.
9. Each letter must feel written for this specific job at this specific company.`;

// ---------------------------------------------------------------------------
// User prompt builder
// ---------------------------------------------------------------------------

export function buildCoverLetterPrompt(input: CoverLetterInput): string {
  const { job, profile, resume } = input;

  // Build a ranked skill summary — expert first, then strong
  const expertSkills = profile.skills
    .filter(s => s.confidence === "expert")
    .map(s => `${s.name} (${s.years}yr)`);
  const strongSkills = profile.skills
    .filter(s => s.confidence === "strong")
    .map(s => `${s.name} (${s.years}yr)`);

  // Matched skills — job required/preferred skills the candidate has
  const profileSkillSet = new Set(profile.skills.map(s => s.name.toLowerCase()));
  const matchedSkills = job.required_skills
    .filter(s => s.importance === "required" || s.importance === "preferred")
    .filter(s => profileSkillSet.has(s.name.toLowerCase()))
    .map(s => s.name)
    .slice(0, 10);

  // Missing required skills — what the job needs that the candidate doesn't have
  const missingRequired = job.required_skills
    .filter(s => s.importance === "required")
    .filter(s => !profileSkillSet.has(s.name.toLowerCase()))
    .map(s => s.name);

  // YOE requirement
  const yoe = (job.yoe_min !== null || job.yoe_max !== null)
    ? `${job.yoe_min ?? "?"}–${job.yoe_max ?? "?"} years`
    : "not specified";

  // Full responsibilities list
  const respLines = job.responsibilities.length
    ? job.responsibilities.map((r, i) => `  ${i + 1}. ${r}`).join("\n")
    : "  not extracted";

  // Skills quality signal
  const skillsQuality = job.score_components.skills >= 0.75
    ? "strong direct match"
    : job.score_components.skills >= 0.55
    ? "solid partial match"
    : "semantic match — some gaps";

  const resumeSection = resume?.trim()
    ? `CANDIDATE RESUME / BACKGROUND:\n${resume.trim()}`
    : `CANDIDATE RESUME: Not provided. Write from skills and years of experience only. Be concrete about technologies but do not invent specific projects or employers.`;

  const visaNote = job.visa_sponsorship === true
    ? "Visa sponsorship is explicitly offered — no need to mention it."
    : job.visa_sponsorship === false
    ? "CAUTION: Job says no sponsorship. Do not mention visa at all — this is an edge case."
    : `Visa sponsorship not mentioned. In the closing paragraph, include exactly one factual sentence: "I hold OPT work authorization and will require employer sponsorship." Do not soften it, do not make it passive.`;

  // Mandatory gap note — surfaces in P3 if required skills are missing
  const gapNote = missingRequired.length > 0
    ? `MANDATORY MISSING SKILLS (required by job, not in candidate profile): ${missingRequired.join(", ")}
Paragraph 3 MUST acknowledge these gaps directly. Frame as a learning commitment
backed by evidence (e.g. past adoption of Camunda, Drools, Keycloak). Do not ignore them.`
    : "No mandatory skill gaps detected — no gap acknowledgment needed.";

  const concernsNote = job.judge_concerns?.length
    ? `Judge concerns (for context — gaps must be addressed in P3 per gap rule above):\n${job.judge_concerns.map(c => `  - ${c}`).join("\n")}`
    : "Concerns: none";

  // Opening reminder — enforced at inference time
  const titleTerms = extractTitleKeywords(job.title);
  const openingReminder = `CRITICAL — OPENING SENTENCE (read before writing word one):

BANNED — do not use, do not paraphrase, do not use similar structure:
  ✗ "[N] years of experience [verb]ing"
  ✗ "Decomposing a monolithic"
  ✗ "Designing scalable applications in an agile environment"
  ✗ "directly aligns with" — banned as a pivot phrase anywhere in P1
  ✗ Any opener reusable for a different company or role

REQUIRED:
  - Name ${job.company} in sentence 1 or 2
  - Reference at least one of: ${titleTerms.join(", ")}
  - Start from ONE concrete result from the candidate's background — pick the one
    most specific to this role, not the most impressive one in general
  - The opening sentence must be structurally different from any other letter`;

  return `Write a cover letter for the following application.

TARGET JOB:
  Title:           ${job.title}
  Company:         ${job.company}
  Domain:          ${job.domain ?? "not specified"}
  Employment type: ${job.employment_type ?? "not specified"}
  YOE required:    ${yoe}
  Visa:            ${job.visa_sponsorship === true ? "sponsorship offered" : job.visa_sponsorship === false ? "no sponsorship" : "not mentioned"}

ROLE RESPONSIBILITIES (use these to anchor paragraph 1 — pick the most specific ones):
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

JUDGE REASONING (what makes this a good match — reference these themes):
${job.judge_reasoning ?? "Strong skill and seniority alignment."}

${concernsNote}

VISA INSTRUCTION: ${visaNote}

${openingReminder}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the most distinctive keywords from a job title for the opening
 * sentence constraint. Strips seniority words and generic terms.
 */
function extractTitleKeywords(title: string): string[] {
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