/**
 * prompt.ts — system prompt and user prompt builder for the LLM judge.
 */

import * as crypto from "crypto";

import type { Profile } from "@/filter/types";
import type { JudgeInput } from "./types";

export const PROMPT_VERSION = "v4";

export function buildCandidateProfileSection(profile: Profile): string {
  const expert = profile.skills
    .filter(s => s.confidence === "expert")
    .map(s => s.name)
    .slice(0, 8);
  const strong = profile.skills
    .filter(s => s.confidence === "strong")
    .map(s => s.name)
    .slice(0, 12);
  const visaLine = profile.work_authorization.requires_sponsorship
    ? `Requires ${profile.work_authorization.visa_type} visa sponsorship`
    : "No sponsorship required";
  const locTypes = profile.location.acceptable_types.join("/");
  const titles = profile.target_titles.slice(0, 3).join(" / ");
  const minComp = profile.compensation.min_acceptable.toLocaleString();
  const domains = profile.preferred_domains.join(", ");

  return `CANDIDATE PROFILE:
- ${profile.years_experience} years of experience. Expert in ${expert.join(", ")}.
- Strong: ${strong.join(", ")}.
- ${visaLine}. Located in ${profile.contact.city}, ${profile.contact.state} (open to ${locTypes} in USA).
- Target: ${titles}. Minimum $${minComp} annual.
- Preferred domains: ${domains}.`;
}

export function buildSystemPrompt(
  profile: Profile,
  rolesList?: string,
  canonicalSkills?: string,
): string {
  const candidateSection = buildCandidateProfileSection(profile);
  const rolesSection = rolesList?.trim()
    ? `\n\nCANDIDATE WORK HISTORY (for tailoring hints):\n${rolesList.trim()}`
    : "";
  const skillsSection = canonicalSkills?.trim()
    ? `\n\nCANDIDATE FULL SKILLS LIST (verbatim from resume):\n${canonicalSkills.trim()}\n\nWhen identifying gaps, FIRST check this list. Do not flag a technology as a gap if it appears here.`
    : "";

  return `You are a job application screener for a senior software engineer.

${candidateSection}${rolesSection}${skillsSection}

CONTEXT:
A deterministic hard filter and scorer (threshold 0.55) already confirmed this job is worth reviewing.
Your task: decide if it is genuinely worth the candidate's time to apply, and produce structured guidance
for the resume + cover letter generators that run downstream.

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
8. If skills = 1.00 and skills_required = "none extracted", note it as a concern but do NOT use it as a STRONG signal — treat technical fit as unknown.

OUTPUT FORMAT:
Return JSON with exactly this shape:
{
  "verdict":     "STRONG" | "MAYBE" | "WEAK",
  "confidence":  0.0 to 1.0 (your own confidence in the verdict, not the score),
  "reasoning":   "1-3 sentence explanation",
  "concerns":    ["specific concern strings"],

  "key_matches": [
    "Concrete strength as a short phrase, naming the candidate role and the JD requirement it addresses."
  ],
  "gaps": [
    {
      "requirement": "what the JD asks for that the candidate lacks",
      "severity": "minor" | "moderate" | "major",
      "reframe_angle": "honest adjacent experience the candidate can surface — never fabrication"
    }
  ],
  "why_apply": "1-2 sentences naming a specific reason this company/role fits the candidate, derived from JD and profile.",
  "tailoring_hints": {
    "emphasize_roles": ["role names from work history that should lead the resume"],
    "emphasize_skills": ["skills from candidate profile that should appear prominently"],
    "downplay_skills": ["skills present in canonical but not relevant to this JD"],
    "domain_reframe_angle": "If JD requires a domain the candidate hasn't directly worked in, the honest reframe — else empty string",
    "tech_swaps": [{"from": "Camunda BPMN", "to": "Flowable", "confidence": 0.9}]
  }
}

GUIDANCE FOR THE NEW FIELDS:
- key_matches: 3-5 entries. Each must name a SPECIFIC role and a SPECIFIC JD requirement. Generic statements ("strong Java skills") are not acceptable.
- gaps: every JD requirement the candidate genuinely lacks. severity: minor (1 missing tool/lib), moderate (missing methodology or years), major (missing domain or core stack). reframe_angle MUST be honest — adjacent experience the candidate can truthfully claim.
- why_apply: NOT generic. Name a domain, project, team, or stated company value from the JD that intersects the candidate's history.
- tailoring_hints.emphasize_roles: pull from CANDIDATE WORK HISTORY block above by exact role string.
- tailoring_hints.emphasize_skills / downplay_skills: pull from the candidate profile skills, NOT invent new ones.
- tailoring_hints.tech_swaps: emit ONLY when a JD required_skill has risk_entry.relationship === "direct_equivalent" AND risk_entry.swap_allowed === true. from = risk_entry.candidate_source_skill, to = risk_entry.target_skill, confidence = risk_entry.confidence. Empty array when no swaps apply.
- Empty arrays/strings are fine when nothing applies. Do not invent.

RISK MAP USAGE (CRITICAL):
Every JD required_skill now has an attached \`risk_entry\`. Use it to set verdict honestly.

INTERPRETATION:
- relationship "exact" or "reworded" → candidate has it. NOT a gap.
- relationship "direct_equivalent" → emit tailoring_hints.tech_swaps:
    { from: <candidate_source_skill>, to: <target_skill> }
  This is a known-defensible swap. NOT a gap, NOT a true-gap.
- relationship "adjacent" → reframe only. Emit a gap with reframe_angle drawn from
  risk_entry.safe_language[] verbatim. NEVER produce a tech_swap for adjacent entries.
- relationship "unsupported_inference" → emit gap with severity "major". reframe_angle
  must use safe_language[]. Note this in concerns[].
- relationship "fabricated" → emit gap with severity "major". reframe_angle must use
  safe_language[]. Strong concern in concerns[].
- risk_entry === null → JD skill not in the map. Treat as fabricated-tier risk.
  Emit gap with severity "major", reframe_angle = "no defensible source in candidate's
  resume; honest framing only".

DISALLOWED CLAIMS:
If a risk_entry has disallowed_claims[], your verdict-related output (concerns, reasoning)
must reflect those constraints. Do not write reframe language that violates them.

NEVER produce a tailoring_hints.tech_swaps entry where the map says swap_allowed === false.`;
}

export function computeSystemPromptSha(systemPrompt: string): string {
  return crypto.createHash("sha256").update(systemPrompt, "utf8").digest("hex").slice(0, 12);
}

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

Return JSON exactly matching the OUTPUT FORMAT in the system prompt (no markdown fences).`;
}
