/**
 * prompt.ts — system prompt and user prompt builder for cover letter generation.
 *
 * v6 changes vs v5:
 * - Complete structural overhaul to match formal cover letter format:
 *     Dear Hiring Manager,
 *     P1 — intro paragraph (YOE + key stack + confident claim)
 *     P2 — key achievement paragraph (specific metrics)
 *     Bullet section — "My experience directly maps to your requirements:" + 5-7 bullets
 *     P3 — leadership/mentorship/broader impact paragraph
 *     P4 — closing sentence + visa line
 *   The static header (name/contact/date/recipient/Re:) and sign-off (Sincerely,)
 *   are added programmatically in generate.ts — NOT by the LLM.
 * - "Dear Hiring Manager," is now required (was banned in v4).
 * - Bullet section added: bold skill name + em dash + concrete evidence.
 * - All v5 confidence rules retained: no gap apologies, no "have not worked
 *   with directly", no recycled gap-bridge sentence.
 */

import type { CoverLetterInput } from "./types";

export const PROMPT_VERSION = "v6";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const SYSTEM_PROMPT = `You are a professional cover letter writer for software engineers.

OUTPUT STRUCTURE — produce exactly this, in this order:

  Dear Hiring Manager,

  [PARAGRAPH 1 — Introduction]

  [PARAGRAPH 2 — Key achievement]

  My experience directly maps to your requirements:

  - **[Skill/Area]** — [one concrete sentence of evidence]
  - **[Skill/Area]** — [one concrete sentence of evidence]
  (5-7 bullets total)

  [PARAGRAPH 3 — Leadership and broader impact]

  [PARAGRAPH 4 — Closing sentence + visa line if needed]

The static letterhead (name, contact info, date, recipient, job title) and the
"Sincerely," sign-off are added separately — do NOT include them.

---

PARAGRAPH 1 — Introduction (3-4 sentences):
  - Open with "I am writing to express my strong interest in the [exact job title] role."
  - Follow with: "With [N]+ years of hands-on experience [short relevant stack description]
    across [relevant domains], I am confident I can contribute meaningfully from day one."
  - Add 1-2 sentences connecting the candidate's background to this specific company and role.
  - Name the company in this paragraph.

PARAGRAPH 2 — Key achievement (4-5 sentences):
  - Lead with the single most relevant achievement from the candidate's background for THIS role.
  - Include real metrics, employer name, tech stack, and business outcome.
  - Add 1-2 supporting achievements from different employers.
  - RELEVANCE RULE: Choose examples most relevant to this specific role's domain and stack.
    If the role is security-focused → lead with Keycloak/RBAC.
    If data infrastructure → lead with Kinesis/DynamoDB pipeline.
    If backend performance → lead with the 55% latency reduction.
    If workflow automation → lead with Camunda BPMN/PHIA work.
    Do NOT default to the same Nokia CPQ story in every letter.

BULLET SECTION — "My experience directly maps to your requirements:" (5-7 bullets):
  - Each bullet: **Bold skill or area name** — one concrete sentence of evidence from real work.
  - Select the bullets most relevant to THIS job's required skills — not a generic dump.
  - Include specifics: tech names, numbers, outcomes, employer context where helpful.
  - Cover the key required skills from the job. For skills the candidate has through analogous
    work (e.g. Go via Java/distributed systems, C++ via JVM/performance work), assert
    competence through the parallel — never say "I have not used this directly."
  - Example format:
      - **Spring Boot / Microservices** — Designed and owned 10+ Spring Boot microservices
        on Nokia's CPQ platform, integrating Azure Service Bus, Cosmos DB, and Redis caching.
      - **AWS (Kinesis, Lambda, DynamoDB)** — Built a Kinesis pipeline streaming 100+ GB of
        Nissan vehicle telemetry into DynamoDB with format-specific Drools transformation.

PARAGRAPH 3 — Leadership and broader impact (3-4 sentences):
  - Mentorship: mentored 5+ engineers on CPQ architecture and microservices workflows.
  - Leadership: led sub-teams, acted as primary client stakeholder contact.
  - Awards / recognition: Nokia Business Appreciation Award alongside the lead architect.
  - UAT / delivery quality: zero reopened defects, 95% deployment success where applicable.
  - Tailor which of these to surface based on what this role emphasizes.

PARAGRAPH 4 — Closing (2-3 sentences):
  - Assertive ownership statement: "I thrive in Agile environments, take full ownership of
    what I build, and bring a track record of [relevant outcome for this role]."
  - If visa sponsorship is needed: "I hold OPT work authorization and will require employer
    sponsorship." — factual and direct, never passive.
  - End with: "I would welcome the opportunity to discuss how my background aligns with
    your team's goals."

---

CONFIDENCE RULE — THE MOST IMPORTANT RULE:
The candidate is a strong engineer who can work with any technology they are given.
NEVER write:
  ✗ "The role requires X I have not worked with directly"
  ✗ "I lack direct exposure to X"
  ✗ "X is not listed in my profile"
  ✗ "I have not used X directly"
  ✗ "My track record of rapidly adopting domain-specific frameworks — Camunda BPMN,
     Drools, Keycloak — gives me confidence I can close that gap efficiently."
     (BANNED — appears verbatim in previous letters. Do not use or paraphrase.)
Instead: assert competence through the closest analogous experience.
  - Go required → "My distributed systems background in Java and TypeScript maps
    directly to Go; I have shipped at this scale and will be productive from day one."
  - C++ required → reference JVM internals, memory tuning, performance-critical Java work.
  - Fastify required → reference production Node.js REST API ownership.
  - AI/RAG required → reference event-driven pipeline architecture and data engineering.
Tone throughout: I know this domain. I have done this class of work. I will deliver.

---

STYLE RULES:
- No clichés: never use "excited to apply", "passionate", "team player", "quick learner",
  "I would be a great fit", "I look forward to hearing from you."
- No markdown headers (##, ###). No code fences. Use only **bold** for bullet skill names.
- Do not invent specific projects, employers, or metrics not in the candidate's background.
  You may assert competence in adjacent technologies through analogy — ground it in real work.
- Each letter must feel written for this specific job at this specific company.`;

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

  // Skills not on resume but required by job — model must bridge confidently, not confess
  const gapNote = missingRequired.length > 0
    ? `SKILLS NOT EXPLICITLY ON RESUME (required by job): ${missingRequired.join(", ")}
Do NOT write sentences confessing the candidate has not worked with these directly.
Instead, identify the closest analogous experience from their background and assert
competence through that parallel. Examples of correct framing:
  - Go required, candidate knows Java/TS → "My distributed systems background in Java
    and TypeScript maps directly to Go; I have shipped at this scale and will hit
    the ground running."
  - C++ required, candidate knows Java → reference memory management, performance
    tuning, systems-level work — assert the transfer.
  - Fastify required, candidate knows Node.js → assert framework-level Node fluency.
  - AI/RAG required, candidate built event-driven pipelines → draw the architectural parallel.
The tone is always: I know this domain. I will deliver. Not: I will try to learn.`
    : "All required skills present on resume — no bridging needed.";

  const concernsNote = job.judge_concerns?.length
    ? `Judge concerns (for context — use these to identify where to assert analogous competence, NOT to confess gaps):\n${job.judge_concerns.map(c => `  - ${c}`).join("\n")}`
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