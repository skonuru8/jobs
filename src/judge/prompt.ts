/**
 * prompt.ts — system prompt and user prompt builder for the LLM judge.
 *
 * Design:
 * - Candidate profile is baked into the system prompt (single-user system).
 * - Judge receives structured job data + score breakdown, NOT raw JD text.
 * - Three verdicts: STRONG | MAYBE | WEAK (with routing logic in judge.ts).
 * - Temperature 0 (set in config). JSON mode enforced.
 */

import type { JudgeInput } from "./types";

export const PROMPT_VERSION = "v2";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const SYSTEM_PROMPT = `You are a job application screener for a senior software engineer.

CANDIDATE PROFILE:
- 6 years of experience. Expert in Java, Spring Boot, Angular, Azure, CI/CD.
- Strong: TypeScript, Python, AWS, Kafka, Docker, Node.js, Microservices, Hibernate/JPA.
- Requires OPT visa sponsorship. Located in Jersey City NJ (open to remote/hybrid/onsite in USA).
- Target: senior/staff-level full-stack or backend roles. Minimum $110k annual.
- Preferred domains: fintech, healthcare, telecom, enterprise SaaS.

CONTEXT:
A deterministic hard filter and scorer (threshold 0.55) already confirmed this job is worth reviewing.
Your task: decide if it is genuinely worth the candidate's time to apply.

VERDICT DEFINITIONS:
- STRONG: Clearly a good fit. Strong skill overlap with the candidate's stack, appropriate seniority, no major blockers. Sponsorship offered OR not mentioned — both are fine for STRONG. Apply confidently.
- MAYBE: Uncertain factors worth a closer look. Skills score < 0.45 indicating meaningful technology gap, YOE gap of 1–2 years, or niche/unusual requirements worth verifying (e.g., Guidewire, Gosu, security clearance ambiguity). Visa not mentioned is at most a MAYBE flag — it is NOT a WEAK trigger. STAFFING AGENCY POSTS ARE NOT INHERENTLY MAYBE: Apex Systems, BCforward, Cynet, SAIC, Software Guidance & Assistance, Ampcus, and similar are legitimate channels for Java contracting in the candidate's market. Treat them as STRONG when skills overlap is good (>= 0.55) and seniority/YOE fit. Only downgrade staffing-agency posts when there are OTHER concerns beyond the agency posting itself.
- WEAK: Not worth applying. Requires ONE OR MORE hard blockers: (a) visa_sponsorship explicitly false when OPT required, (b) severely wrong tech stack with skills < 0.35 AND no compensating semantic overlap (semantic < 0.50), (c) YOE requirement >= 12 years (candidate has 6 — gap too large to bridge credibly), (d) niche/unrelated stack (Guidewire/Gosu, Salesforce Apex, mainframe COBOL, SAP ABAP) with skills < 0.45. C2C/staffing-agency posting alone is NOT a WEAK trigger.

SPONSORSHIP RULE (CRITICAL):
- visa_sponsorship = true  → positive signal
- visa_sponsorship = null  → unknown. Many companies sponsor but don't list it. Treat as neutral. STRONG verdicts ARE allowed when sponsorship is not mentioned.
- visa_sponsorship = false → WEAK, always. This is the ONLY hard sponsorship rule.
- NEVER treat "not mentioned" as equivalent to "no sponsorship". They are different.

SCORING GUIDE (context only — do not re-score):
- skills >= 0.70: strong match on required technologies
- skills 0.50-0.69: partial match, some technology gaps
- skills < 0.50: significant skill gap (semantic may have compensated)
- yoe < 0.80: candidate is underqualified by more than 2 years relative to the requirement
- skills = 1.00 with 0 extracted skills: extraction failed or no skills listed — treat as unknown, not perfect match

RULES:
1. Return valid JSON only. No markdown, no explanation, no preamble.
2. Compensation is pre-filtered. Do NOT reject for pay.
3. Location type is pre-filtered. Do NOT reject for remote/hybrid/onsite.
4. If visa_sponsorship = false → always WEAK (hard rule). If visa_sponsorship = null → never auto-WEAK.
5. third_party_contract flag alone is NOT a downgrade trigger. Only downgrade when paired with another concern (poor skills match, YOE gap, niche stack, or no end client AND no clear technology requirements).
6. Do not hallucinate requirements not in the job data.
7. reasoning: 1-3 sentences. concerns: list of strings (empty list if none).
8. If skills = 1.00 and skills_required = "none extracted", note it as a concern but do NOT use it as a STRONG signal — treat technical fit as unknown.`;

// ---------------------------------------------------------------------------
// User prompt
// ---------------------------------------------------------------------------

export function buildJudgePrompt(input: JudgeInput): string {
  const { job, score } = input;

  const skillsText = job.required_skills
    .slice(0, 15)
    .map(s => {
      const yr = s.years_required ? `, ${s.years_required}yr` : "";
      return `${s.name} (${s.importance}${yr})`;
    })
    .join(", ") || "none extracted";

  const yoe = (job.years_experience.min !== null || job.years_experience.max !== null)
    ? `${job.years_experience.min ?? "?"}–${job.years_experience.max ?? "?"} years`
    : "not specified";

  const visaText = job.visa_sponsorship === true
    ? "sponsorship offered"
    : job.visa_sponsorship === false
    ? "NO sponsorship (explicitly stated)"
    : "not mentioned";

  const respText = job.responsibilities.slice(0, 4).join("; ") || "not specified";
  const flagsText = job.flags.length ? job.flags.join(", ") : "none";

  const fmt = (n: number) => n.toFixed(2);

  return `Evaluate this job for the candidate described in the system prompt.

JOB:
  Title:            ${job.title}
  Company:          ${job.company}
  Employment type:  ${job.employment_type ?? "unspecified"}
  Seniority:        ${job.seniority ?? "unspecified"}
  Domain:           ${job.domain ?? "unspecified"}
  YOE required:     ${yoe}
  Education:        ${job.education_required.minimum || "not specified"}
  Visa sponsorship: ${visaText}
  Skills required:  ${skillsText}
  Responsibilities: ${respText}
  Flags:            ${flagsText}

SCORE BREAKDOWN (total: ${fmt(score.total)}, gate threshold: 0.55):
  Skills     ${fmt(score.components.skills)}   (40% weight)
  Semantic   ${fmt(score.components.semantic)}   (10% weight)
  YOE        ${fmt(score.components.yoe)}   (25% weight)
  Seniority  ${fmt(score.components.seniority)}   (15% weight)
  Location   ${fmt(score.components.location)}   (10% weight)

Return JSON with exactly this shape:
{
  "verdict":   "STRONG" | "MAYBE" | "WEAK",
  "reasoning": "1-3 sentence explanation",
  "concerns":  ["specific concern 1", "specific concern 2"]
}`;
}