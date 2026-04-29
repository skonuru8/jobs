/**
 * prompt.ts — system prompt and user prompt builder for JD extraction.
 *
 * Design principles (bible §extractor):
 * - "Extract, don't infer" — null if not stated in the text
 * - Citation-based: every field includes a quote from the source text
 * - Section-aware: model told to look for Requirements vs Responsibilities separately
 * - Temperature 0 (set in config)
 */

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

SKILL IMPORTANCE:
- "required": explicitly stated as required, must-have, or necessary
- "preferred": stated as preferred, desired, or a plus
- "nice_to_have": stated as nice to have, bonus, or optional

SKILL CATEGORY:
- "language": programming languages (Java, Python, TypeScript, etc.)
- "framework": frameworks and libraries (Spring Boot, React, Angular, etc.)
- "cloud": cloud platforms and services (AWS, Azure, GCP, Lambda, S3, etc.)
- "tool": tools, databases, platforms (Redis, Kafka, Docker, Postgres, etc.)
- "methodology": practices and processes (Agile, TDD, CI/CD, microservices, etc.)
- "other": anything that doesn't fit above

EDUCATION MINIMUM VALUES:
- "bachelor", "master", "phd", "associate", "none", or "" if not mentioned

SECURITY CLEARANCE VALUES:
- "none" (default, use when not mentioned)
- "required" (must have clearance)
- "preferred" (clearance is a plus)
- "unknown" (mentioned but unclear)

VISA SPONSORSHIP:
- true: sponsorship is explicitly offered
- false: explicitly states no sponsorship / must be authorized
- null: not mentioned`;

// ---------------------------------------------------------------------------
// User prompt
// ---------------------------------------------------------------------------

export function buildUserPrompt(descriptionRaw: string): string {
  const MAX_JD_CHARS = 4000;
  const truncated = descriptionRaw.length > MAX_JD_CHARS
    ? descriptionRaw.slice(0, MAX_JD_CHARS) + "\n[truncated]"
    : descriptionRaw;
  return `Extract structured data from this job description.

JOB DESCRIPTION:
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
  "visa_sponsorship": true | false | null,
  "security_clearance": "none" | "required" | "preferred" | "unknown",
  "domain": "string describing the business domain (e.g. fintech, healthcare, telecom) | null"
}`;
}