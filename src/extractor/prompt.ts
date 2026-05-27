/**
 * prompt.ts — system prompt and user prompt builder for JD extraction.
 *
 * Design principles (bible §extractor):
 * - "Extract, don't infer" — null if not stated in the text
 * - Citation-based: every field includes a quote from the source text
 * - Section-aware: model told to look for Requirements vs Responsibilities separately
 * - Temperature 0 (set in config)
 */

import type { JdSegments } from "./segment";

export const PROMPT_VERSION = "v1";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const SYSTEM_PROMPT = `You are a structured data extractor for job descriptions.

RULES:
1. Extract, never infer. If something is not stated in the text, return null.
2. For every extracted value, include a "quote" field: a short verbatim phrase (5-15 words) from the job description that directly supports the extracted value.
3. Quotes must be exact substrings of the original text. Do not paraphrase or modify quotes.
4. Return valid JSON only. No markdown, no explanation, no preamble.
 
================================================================
SKILLS — HOW TO FIND THEM (READ THIS BEFORE EXTRACTING)
================================================================

WHERE skills come from (in priority order):
  1. Tag chips / qualification chips — standalone tokens often rendered as comma/pipe/bullet-separated lists of technology names near "Qualifications", "Skills", or at the top of the JD. Example: "Java | AWS | Hibernate | Spring Framework | Software Testing".
  2. Lines under headers like "Required", "Must Have", "Mandatory", "Qualifications", "Requirements". Importance = "required".
  3. Lines under headers like "Preferred", "Nice to Have", "Plus", "Bonus", "Good to Have", "Nice", "Desired". Importance = "preferred" or "nice_to_have".
  4. Tech stated in role overview ("our stack is X, Y, Z"). Importance = "required" if the stack is core, else "preferred".

WHAT counts as a skill:
  A skill is a NAMED TECHNOLOGY, PRODUCT, LANGUAGE, FRAMEWORK, OR TOOL.
  Examples of valid skills: "Java", "Spring Boot", "AWS Lambda", "Kubernetes", "PostgreSQL", "Cypress", "GraphQL", "Kafka", "Terraform", "React".

WHAT IS NOT A SKILL — never extract these:
  - Abstract qualities used as nouns in prose: "programming", "CS fundamentals", "architecture" (when describing a quality, not a named product), "communication", "ownership", "documentation", "testing" (as an activity verb).
  - Soft skills: "collaboration", "leadership", "curious", "fast-paced".
  - Generic verbs / activities: "shipping code", "building features", "writing tests".

Test you must apply to every candidate skill:
  Q: "Could I install/import/configure this? Is it a vendor product, a language, or a library?"
  YES -> it's a skill, extract it.
  NO  -> it's a quality or activity, skip it.

PREFERRED / NICE-TO-HAVE SECTIONS (CRITICAL):
  Always scan these sections. Skills listed there are real skills. Emit each one with importance = "preferred" or "nice_to_have", never drop them. Many JDs put their actual tech stack in Preferred when the Required section is written as abstract qualities.

DUPLICATES:
  If the same technology appears in both Required and Preferred, emit it once with importance = "required".

================================================================
SKILL IMPORTANCE:
- "required":     explicitly stated as required, must-have, or necessary
- "preferred":    stated as preferred, desired, or a plus
- "nice_to_have": stated as nice to have, bonus, or optional

SKILL CATEGORY:
- "language": programming languages (Java, Python, TypeScript, etc.)
- "framework": frameworks and libraries (Spring Boot, React, Angular, etc.)
- "cloud": cloud platforms and services (AWS, Azure, GCP, Lambda, S3, etc.)
- "tool": tools, databases, platforms (Redis, Kafka, Docker, Postgres, etc.)
- "methodology": practices and processes (Agile, TDD, CI/CD, microservices, etc.)
- "other": anything that doesn't fit above

EDUCATION MINIMUM VALUES:
  "bachelor", "master", "phd", "associate", "none", or "" if not mentioned.

SECURITY CLEARANCE VALUES:
  "none" (default), "required", "preferred", "unknown".

================================================================
VISA SPONSORSHIP — semantic enum (READ CAREFULLY)
================================================================

Return ONE of these five string values:

  "offered"             — JD explicitly offers sponsorship.
                          Triggers: "sponsorship available", "will sponsor",
                          "H-1B welcome", "visa sponsorship offered".

  "denied"              — JD explicitly refuses sponsorship.
                          Triggers: "no sponsorship", "will not sponsor",
                          "cannot sponsor", "US citizens only", "USC only",
                          "no H-1B", "must be authorized to work without
                          sponsorship now or in the future".

  "ead_eligible"        — JD lists work-auth categories that INCLUDE non-citizen
                          options like EAD, OPT, GC, or H-1B.
                          Triggers: "Open to EAD/GC/USC", "EAD OK",
                          "H-1B candidates welcome", "OPT eligible",
                          "Authorized to work in the US (any status)".

  "payment_model_only"  — JD restricts PAYMENT MODEL only, not authorization.
                          Triggers: "W-2 only", "no C2C", "no corp-to-corp",
                          "no third-party submissions", "direct hire only"
                          WHEN THESE APPEAR WITHOUT any sponsorship language.
                          These clauses concern contracting model; they do NOT
                          block H-1B / OPT candidates working W-2.

  "unmentioned"         — Authorization or sponsorship is not addressed anywhere
                          in the JD.

CRITICAL DISTINCTIONS:
  - "W-2 only" alone -> "payment_model_only", NEVER "denied".
  - "No C2C" alone -> "payment_model_only", NEVER "denied".
  - "USC only" / "US citizens only" -> "denied".
  - "Open to EAD" -> "ead_eligible", NEVER "unmentioned".
  - If BOTH a payment-model restriction AND a sponsorship denial appear,
    "denied" wins.

Include the verbatim phrase that drove your choice in the "visa_quote" field.`;

// ---------------------------------------------------------------------------
// User prompt
// ---------------------------------------------------------------------------

export function buildUserPrompt(descriptionRaw: string): string {
  return buildUserPromptWithSegments({
    tags_chips: "",
    required: "",
    preferred: "",
    responsibilities: "",
    other: descriptionRaw,
  });
}

export function buildUserPromptWithSegments(segments: JdSegments): string {
  const MAX_JD_CHARS = 4000;
  const segmentText = `TAGS/CHIPS:
${segments.tags_chips || "(none detected)"}

REQUIRED:
${segments.required || "(none detected)"}

PREFERRED:
${segments.preferred || "(none detected)"}

RESPONSIBILITIES:
${segments.responsibilities || "(none detected)"}

OTHER:
${segments.other || "(none detected)"}

Importance per segment:
- TAGS/CHIPS and REQUIRED -> "required"
- PREFERRED -> "preferred"
- RESPONSIBILITIES and OTHER -> infer from context`;
  const truncated = segmentText.length > MAX_JD_CHARS
    ? segmentText.slice(0, MAX_JD_CHARS) + "\n[truncated]"
    : segmentText;
  return `Extract structured data from this job description.

SEGMENTED JOB DESCRIPTION:
---
${truncated}
---

Return a JSON object with exactly this shape:
{
  "required_skills": [
    {
      "name": "string (lowercase)",
      "years_required": number | null,
      "importance": "required" | "preferred" | "nice_to_have",
      "category": "language" | "framework" | "cloud" | "tool" | "methodology" | "other",
      "quote": "exact phrase from text supporting this skill"
    }
  ],
  "years_experience": {
    "min": number | null,
    "max": number | null,
    "quote": "exact phrase from text | null"
  },
  "education_required": {
    "minimum": "bachelor" | "master" | "phd" | "associate" | "none" | "",
    "field": "string | empty string if not specified",
    "quote": "exact phrase from text | null"
  },
  "responsibilities": [
    "string — one responsibility per item, 5-20 words each"
  ],
  "visa_sponsorship": "offered" | "denied" | "ead_eligible" | "payment_model_only" | "unmentioned",
  "visa_quote": "exact phrase from text that drove the visa value | null if unmentioned",
  "security_clearance": "none" | "required" | "preferred" | "unknown",
  "domain": "string describing the business domain (e.g. fintech, healthcare, telecom) | null"
}`;
}
