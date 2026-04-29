/**
 * types.ts — extractor input/output types.
 *
 * ExtractedFields = the structured fields the LLM fills in.
 * These map directly onto the Job schema fields that are empty after scraping.
 */

// Mirrors job-filter/src/types.ts skill importance values
export type Importance = "required" | "preferred" | "nice_to_have";

// Mirrors job-filter/src/types.ts skill categories
export type SkillCategory =
  | "language"
  | "framework"
  | "cloud"
  | "tool"
  | "methodology"
  | "other";

export interface ExtractedSkill {
  name:           string;
  years_required: number | null;
  importance:     Importance;
  category:       SkillCategory;
  quote:          string;   // substring of description_raw — verified before use
}

export interface ExtractedYOE {
  min:   number | null;
  max:   number | null;
  quote: string | null;
}

export interface ExtractedEducation {
  minimum: string;   // "bachelor" | "master" | "phd" | "none" | ""
  field:   string;
  quote:   string | null;
}

/**
 * The structured output the LLM returns.
 * Every quoted field is verified as a substring of description_raw
 * before the result is accepted.
 */
export interface ExtractedFields {
  required_skills:    ExtractedSkill[];
  years_experience:   ExtractedYOE;
  education_required: ExtractedEducation;
  responsibilities:   string[];
  visa_sponsorship:   boolean | null;
  security_clearance: string;   // "none" | "required" | "preferred" | "unknown"
  domain:             string | null;
}

/**
 * Full result returned by extract().
 * Includes metadata for re-extraction and debugging.
 */
export interface ExtractionResult {
  status:         "ok" | "error";
  fields:         ExtractedFields | null;
  model:          string;
  prompt_version: string;
  extracted_at:   string;
  error?:         string;
  // Number of quotes that failed substring verification (informational)
  citation_failures?: number;
}