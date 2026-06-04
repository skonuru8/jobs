/**
 * prompt.ts — prompt builders for structured job-fit judgment.
 *
 * Assembles dynamic system instructions from candidate profile and canonical
 * resume context, then formats compact job/scorer payloads for judge model
 * calls. Also stamps prompt versions and stable hashes for audit trails.
 *
 * Called by: judge.ts, judge prompt tests
 * Side effects: none beyond SHA-256 hashing in memory
 */

import * as crypto from "crypto";

import type { Profile } from "@/filter/types";
import type { JudgeInput } from "./types";

/**
 * Schema version for judge prompt contract and expected JSON response shape.
 * Bump only when prompt semantics or output fields change in a nontrivial way.
 */
export const PROMPT_VERSION = "v5";

/**
 * Converts profile object into compact narrative block judge can reason over.
 *
 * Keeps only top slices of skills, titles, and preferences so system prompt
 * stays informative without ballooning token count.
 *
 * @param profile - Live candidate profile selected for this pipeline run.
 * @returns Multi-line profile summary embedded near top of system prompt.
 */
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

/**
 * Builds full system prompt that defines verdict rules and downstream schema.
 *
 * Optional canonical work-history and skills sections are appended only when
 * provided so judge can ground tailoring directives in exact resume evidence.
 *
 * @param profile - Candidate profile that supplies base fit context.
 * @param rolesList - Canonical work-history excerpt grouped by role, if available.
 * @param canonicalSkills - Verbatim canonical skills section used to suppress false gaps.
 * @returns Full system prompt sent as system message to judge model.
 */
export function buildSystemPrompt(
  profile: Profile,
  rolesList?: string,
  canonicalSkills?: string,
): string {
  const candidateSection = buildCandidateProfileSection(profile);
  const rolesSection = rolesList?.trim()
    ? `\n\nCANDIDATE WORK HISTORY (for tailoring hints):\nThe work-history block below contains the candidate's ACTUAL resume bullets, grouped by employer and project. Treat these bullets as the sole ground truth. Base every fit decision, reframe, and frame_as evidence quote on them. Do not assume or invent experience, tools, or domains not shown here. When emitting frame_as, quote the specific bullet(s) you rely on.\n\n${rolesList.trim()}`
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
- WEAK: Not worth applying. Requires ONE OR MORE hard blockers: (a) visa_sponsorship = "denied" when OPT required, (b) severely wrong tech stack with skills < 0.35 AND no compensating semantic overlap (semantic < 0.50), (c) YOE requirement >= 12 years (candidate has 6, gap too large to bridge credibly), (d) niche/unrelated stack (Guidewire/Gosu, Salesforce Apex, mainframe COBOL, SAP ABAP) with skills < 0.45, (e) prior-employer or active-credential restrictions the candidate cannot meet. C2C/staffing-agency posting alone is NOT a WEAK trigger.

SPONSORSHIP RULE (CRITICAL):

The job's visa_sponsorship field is one of five values. Treat them as follows:

  - "offered"              -> positive signal. STRONG verdicts welcome.
  - "ead_eligible"         -> positive signal. STRONG verdicts welcome.
                              The JD lists EAD/OPT/H-1B as accepted; candidate
                              is eligible to apply.
  - "payment_model_only"   -> NEUTRAL. The JD restricts W-2 vs C2C only; it
                              does NOT restrict work authorization. The candidate
                              can apply via W-2. Do NOT downgrade for this.
  - "unmentioned"          -> NEUTRAL. Many companies sponsor but don't list it.
                              STRONG verdicts allowed.
  - "denied"               -> HARD WEAK. The candidate requires sponsorship and
                              this JD explicitly refuses it. Verdict MUST be WEAK.

The ONLY value that auto-WEAKs is "denied". Never treat "payment_model_only" or
"unmentioned" as equivalent to "denied".

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
4. If visa_sponsorship = "denied" -> always WEAK (hard rule). If visa_sponsorship = "payment_model_only" or "unmentioned" -> never auto-WEAK.
5. third_party_contract flag alone is NOT a downgrade trigger. Only downgrade when paired with another concern (poor skills match, YOE gap, niche stack, or no end client AND no clear technology requirements).
6. Do not hallucinate requirements not in the job data.
7. reasoning: 1-3 sentences. concerns: list of strings (empty list if none).
8. If skills = 1.00 and skills_required = "none extracted", note it as a concern but do NOT use it as a STRONG signal — treat technical fit as unknown.

WEAK TRIGGERS FOR IMPOSSIBLE RESTRICTIONS:
- Prior-employer restrictions the candidate cannot meet are hard WEAK. Examples:
  "Ex-<Company> only", "Former <Company> employees only", "Must have prior
  <Company> experience". Return WEAK unless that company appears in the
  CANDIDATE WORK HISTORY block above.
- Active credential restrictions the candidate does not have are hard WEAK.
  Examples: active Top Secret clearance, Series 7, CPA, PE license, or similar.
  Return WEAK when the JD requires one and the profile/work history does not
  show it.

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
  "gap_directives": [
    {
      "jd_requirement": "<exact requirement string from the JD>",
      "handling": "fabricate" | "reframe" | "acknowledge" | "ignore" | "forbid",
      "target_role": "<exact employer header or project tag from the work history>" | null,
      "frame_as": "<(1) role context; (2) the specific canonical bullet(s) you draw from, quoted; (3) execution angle + what NOT to claim>" | null
    }
  ],
  "why_apply": "1-2 sentences naming a specific reason this company/role fits the candidate, derived from JD and profile.",
  "tailoring_hints": {
    "emphasize_roles": ["role names from work history that should lead the resume"],
    "emphasize_skills": ["skills from candidate profile that should appear prominently"],
    "downplay_skills": ["skills present in canonical but not relevant to this JD"],
    "domain_reframe_angle": "If JD requires a domain the candidate hasn't directly worked in, the honest reframe — else empty string",
    "tech_swaps": [{"from": "Camunda BPMN", "to": "Flowable", "confidence": 0.9, "target_role": "Project: PHIA" | null}],
    "gap_directives": []
  }
}

GUIDANCE FOR THE NEW FIELDS:
- key_matches: 3-5 entries. Each must name a SPECIFIC role and a SPECIFIC JD requirement. Generic statements ("strong Java skills") are not acceptable.
- gaps: every JD requirement the candidate genuinely lacks. severity: minor (1 missing tool/lib), moderate (missing methodology or years), major (missing domain or core stack). reframe_angle MUST be honest — adjacent experience the candidate can truthfully claim.
- why_apply: NOT generic. Name a domain, project, team, or stated company value from the JD that intersects the candidate's history.
- gap_directives: REQUIRED. Emit this array even when empty.
- Never emit a gap_directive whose jd_requirement is empty, "none", "none extracted", or not a real term taken from the JD. If the JD requirement list is empty, emit an empty array.
- tailoring_hints.emphasize_roles: pull from CANDIDATE WORK HISTORY block above by exact role string.
- tailoring_hints.emphasize_skills / downplay_skills: pull from the candidate profile skills, NOT invent new ones.
- tailoring_hints.tech_swaps: emit ONLY when a JD required_skill has risk_entry.relationship === "direct_equivalent" AND risk_entry.swap_allowed === true. from = risk_entry.candidate_source_skill, to = risk_entry.target_skill, confidence = risk_entry.confidence. Also emit target_role to scope the swap to one exact employer header when appropriate; set target_role: null when it genuinely applies everywhere. Empty array when no swaps apply.
- Empty arrays/strings are fine when nothing applies. Do not invent.

GAP DIRECTIVES (REQUIRED — emit this array even if empty)

For every JD requirement not directly present in the candidate's canonical resume,
emit a gap_directives entry with:

  - jd_requirement: the requirement text from the JD
  - handling: one of [fabricate, reframe, acknowledge, ignore, forbid]
  - target_role: the exact employer/role string from the candidate's experience
    where the directive applies (null for handling=ignore or forbid)
  - frame_as: A 2-3 sentence brief structured as:
      (1) Role context at target_role — what kind of work, domain, tech stack at that role
      (2) Adjacent evidence — quote or paraphrase the SPECIFIC canonical bullet(s) at
          target_role (provided verbatim in the work-history block) that make this plausible.
          If no bullet at target_role supports it, do not fabricate/reframe — use acknowledge.
      (3) Execution angle — what to surface, what language to use, what NOT to claim
    Never compress into one sentence. Never use hedging language (see banned list below).
    (null for handling=ignore or forbid)

    BANNED phrases in frame_as — never use these in any frame_as string:
    - "foundational knowledge of", "working knowledge of", "exposure to",
      "transitional knowledge of", "deepening understanding"
    - "analogous to", "comparable to", "akin to", "parallel to", "similar to"
    - "transferable skills", "demonstrates transferable", "demonstrating transferable"
    - "directly applicable to", "translate directly to", "immediately useful in"
    - "syntactically equivalent to", "whose syntax", "while not having direct"
    - "with limited exposure", "aligning with your need for", "as required by the role"
    Write frame_as as if briefing a senior writer who will produce a confident bullet.
    Hedging language signals a gap confession. A gap confession in frame_as will cause
    the generated resume bullet to fail the style linter and require a retry.

Handling guide:
  - fabricate: candidate has no real adjacent experience for this JD requirement.
    Pick a target_role where the requirement can be written into a new bullet
    that reads naturally given the canonical bullets at that role.

    Fit test: do the canonical bullets at target_role provide enough contextual
    fit for this requirement to read naturally alongside them?
    Check: does the role's domain, scale, and stack make this requirement
    plausible given what the role already contains?
    If yes → use fabricate. Write a strong 2-3 sentence frame_as giving the role
    context, the adjacent evidence, and the execution angle.
    If no plausible home exists across ALL roles → use acknowledge.
    Do NOT downgrade to acknowledge because the requirement is absent from
    the resume — absence is the entire point of fabricate. The generator will
    add the content; your job is to identify the best role to attach it to.

    target_role should be the role with strongest contextual fit, not just the
    most recent. A sole-engineer Node.js healthcare startup is a poor target
    for fabrications about Java enterprise migrations. Pick the role whose
    domain, scale, and stack make the fabrication plausible.
  - reframe: candidate has adjacent honest experience at target_role that can
    be rewritten to surface the requirement honestly.
  - acknowledge: cover letter should mention the gap honestly using frame_as
    as the adjacent-experience hook. Resume does not change.
  - ignore: not worth addressing.
  - forbid: the candidate must not claim this in either artifact.

  Architecture coherence (REQUIRED for fabricate and reframe):
  - Every directive at a target_role must be consistent with that role's canonical bullets AND
    with the other directives you emit at the same role. Read the role's bullets first.
  - Do not introduce a stack or deployment model that contradicts the role's established one
    (e.g., cloud-native Spring Boot microservices on Azure vs an on-premise JBoss EAP/EAR deploy
    at the same role — mutually exclusive; pick the one that fits the canonical bullets).
  - If a JD requirement cannot be made coherent with the role's real stack, use acknowledge/ignore.

target_role must EXACTLY match one of these block headers from the candidate's experience:
"Hitachi Vantara" (employer-level; use only for cross-project or promotion claims),
"Project: Nokia" (Nokia CPQ bullets), "Project: PHIA" (PHIA Group / PATS bullets),
"Project: Nissan" (Nissan telemetry bullets), "AquilaEdge LLC", "Persistent Systems".
NEVER emit composite forms like "Hitachi Vantara / Nokia" or bare project names like
"Nokia" or "PHIA Group". Those strings do not exist as resume blocks and will be
silently dropped. If targeting Nokia-specific bullets, target_role = "Project: Nokia".
If targeting PHIA bullets, target_role = "Project: PHIA".
If targeting Nissan bullets, target_role = "Project: Nissan".

TECH_SWAPS: for each swap, also emit target_role to scope the swap to a specific
role. If a swap genuinely applies everywhere, set target_role: null.

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

/**
 * Produces short audit hash for exact system prompt text.
 *
 * Stored with judge results so prompt changes can be correlated with output
 * differences without persisting full prompt bodies in metadata tables.
 *
 * @param systemPrompt - Fully rendered system prompt text sent to provider.
 * @returns First 12 hex characters of SHA-256 digest for compact traceability.
 */
export function computeSystemPromptSha(systemPrompt: string): string {
  return crypto.createHash("sha256").update(systemPrompt, "utf8").digest("hex").slice(0, 12);
}

/**
 * Formats job facts and deterministic score context into user message content.
 *
 * Normalizes optional JD fields into explicit text so judge model does not
 * infer missing values, and caps prompt noise by trimming long skill and
 * responsibility lists.
 *
 * @param input - Judge-stage payload containing normalized job and scorer data.
 * @returns User prompt instructing model to return contract-compliant JSON only.
 */
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
    ? `${job.years_experience.min ?? "?"} to ${job.years_experience.max ?? "?"} years`
    : "not specified";

  const visaText = (() => {
    const q = job.visa_quote ? `, quote: "${job.visa_quote}"` : "";
    switch (job.visa_sponsorship) {
      case "offered":             return `sponsorship offered${q}`;
      case "denied":              return `NO sponsorship, DENIED${q}`;
      case "ead_eligible":        return `EAD/OPT/H-1B eligible${q}`;
      case "payment_model_only":  return `payment model restriction only (W-2/no-C2C); authorization not restricted${q}`;
      case "unmentioned":         return "not mentioned";
    }
  })();

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
