/**
 * extract.ts — main extraction logic.
 *
 * Bible requirements:
 * - JSON schema enforcement via JSON mode
 * - Citation-based: every quoted field verified as substring of description_raw
 * - "Extract, don't infer" — enforced via prompt
 * - Zod validation, retry once on failure
 * - Pin model + prompt version on every result
 */

import { complete, ReasoningConfig }         from "./client";
import { SYSTEM_PROMPT, buildUserPrompt, PROMPT_VERSION } from "./prompt";
import { validateExtraction, ValidatedFields } from "./validate";
import { ExtractionResult, ExtractedFields }   from "./types";

// Loaded from config — passed in at call site to avoid circular deps
export interface ExtractorConfig {
  model:       string;
  max_tokens:  number;
  temperature: number;
  reasoning?:  ReasoningConfig;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract structured fields from a job description.
 *
 * Never throws — returns { status: "error" } on any failure.
 * Retries once on Zod validation failure (bible spec).
 * Verifies all quotes as substrings of description_raw.
 */
export async function extract(
  descriptionRaw: string,
  config: ExtractorConfig,
): Promise<ExtractionResult> {
  const extracted_at = new Date().toISOString();

  if (!descriptionRaw.trim()) {
    return {
      status:         "error",
      fields:         null,
      model:          config.model,
      prompt_version: PROMPT_VERSION,
      extracted_at,
      error:          "description_raw is empty — fetch stage must run first",
    };
  }

  const userPrompt = buildUserPrompt(descriptionRaw);

  // First attempt
  let result = await _attempt(userPrompt, config);

  // Retry once on validation failure (bible spec).
  // Brief backoff — pipeline-level throttling already spaces requests.
  if (!result.ok) {
    await new Promise(r => setTimeout(r, 1000));
    result = await _attempt(userPrompt, config);
  }

  if (!result.ok) {
    return {
      status:         "error",
      fields:         null,
      model:          config.model,
      prompt_version: PROMPT_VERSION,
      extracted_at,
      error:          result.error,
    };
  }

  // Verify citations — strip quotes that aren't substrings of the raw text
  const { fields, citationFailures } = verifyCitations(result.data, descriptionRaw);

  return {
    status:            "ok",
    fields,
    model:             config.model,
    prompt_version:    PROMPT_VERSION,
    extracted_at,
    citation_failures: citationFailures,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function _attempt(
  userPrompt: string,
  config: ExtractorConfig,
): Promise<{ ok: true; data: ValidatedFields } | { ok: false; error: string }> {
  let raw: string;
  try {
    raw = await _callWithRetry(userPrompt, config);
  } catch (e: any) {
    return { ok: false, error: `LLM call failed: ${e?.message ?? e}` };
  }

  const result = validateExtraction(raw);
  if (!result.ok && process.env.DEBUG_EXTRACT) {
    // Show truncated raw response so you can diagnose model output issues
    const preview = raw.length > 500 ? raw.slice(0, 500) + `\n...[${raw.length} chars total]` : raw;
    process.stderr.write(`[extract] RAW RESPONSE (validation failed):\n${preview}\n`);
  }
  return result;
}

// One HTTP-level retry for transient errors (timeout, 5xx, network).
// Validation retries happen at the extract() level; this is strictly network resilience.
async function _callWithRetry(userPrompt: string, config: ExtractorConfig): Promise<string> {
  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const,   content: userPrompt },
  ];
  const call = () => complete({
    model:       config.model,
    max_tokens:  config.max_tokens,
    temperature: config.temperature,
    messages,
    ...(config.reasoning ? { reasoning: config.reasoning } : {}),
  });

  try {
    const res = await call();
    return res.content;
  } catch (e) {
    await new Promise(r => setTimeout(r, 2000));
    const res = await call();
    return res.content;
  }
}

/**
 * Verify all quote fields are actual substrings of description_raw.
 * Bad quotes get nulled out (not rejected) — partial extraction is better than none.
 * Returns the cleaned fields + count of failures for observability.
 */
export function verifyCitations(
  fields: ValidatedFields,
  descriptionRaw: string,
): { fields: ExtractedFields; citationFailures: number } {
  const text  = descriptionRaw.toLowerCase();
  let failures = 0;

  const verifiedSkills = fields.required_skills.map(skill => {
    const valid = skill.quote && text.includes(skill.quote.toLowerCase());
    if (!valid) failures++;
    return {
      name:           skill.name,
      years_required: skill.years_required,
      importance:     skill.importance,
      category:       skill.category,
      quote:          valid ? skill.quote : "",
    };
  });

  const yoeQuoteValid =
    fields.years_experience.quote &&
    text.includes(fields.years_experience.quote.toLowerCase());
  if (fields.years_experience.quote && !yoeQuoteValid) failures++;

  const eduQuoteValid =
    fields.education_required.quote &&
    text.includes(fields.education_required.quote.toLowerCase());
  if (fields.education_required.quote && !eduQuoteValid) failures++;

  return {
    fields: {
      required_skills:    verifiedSkills,
      years_experience: {
        min:   fields.years_experience.min,
        max:   fields.years_experience.max,
        quote: yoeQuoteValid ? fields.years_experience.quote : null,
      },
      education_required: {
        minimum: fields.education_required.minimum,
        field:   fields.education_required.field,
        quote:   eduQuoteValid ? fields.education_required.quote : null,
      },
      responsibilities:   fields.responsibilities,
      visa_sponsorship:   fields.visa_sponsorship,
      security_clearance: fields.security_clearance,
      domain:             fields.domain,
    },
    citationFailures: failures,
  };
}