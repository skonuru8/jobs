/**
 * constants.ts — Shared filter-stage enums, mappings, flags, and routing buckets.
 *
 * Centralizes normalized constant sets so extractor output, profile validation,
 * hard filters, and downstream routing all interpret the same closed vocabularies.
 * These values are policy, not implementation detail, so documentation matters.
 *
 * Called by: filter logic, validators, scorer helpers, pipeline routing
 * Writes to: nothing
 * Side effects: none
 */

/**
 * Relative seniority ladder used for coarse comparisons.
 * Higher numbers indicate more senior roles; equal numbers collapse adjacent labels
 * like `senior`, `lead`, and `manager` when filter logic treats them similarly.
 */
export const SENIORITY_LEVEL: Record<string, number> = {
  intern: 0,
  junior: 1,
  mid: 2,
  senior: 3,
  lead: 3,
  manager: 3,
  staff: 4,
  principal: 5,
}

/**
 * Relative education ladder used when jobs specify minimum degree thresholds.
 * Mapping stays intentionally coarse because extraction quality varies across sources.
 */
export const DEGREE_LEVEL: Record<string, number> = {
  none: 0,
  associate: 1,
  bachelor: 2,
  master: 3,
  phd: 4,
}

/** Allowed work arrangement values enforced during job/profile validation. */
export const LOCATION_TYPES = ["remote", "hybrid", "onsite"] as const
/** Allowed employment models enforced during filtering and profile validation. */
export const EMPLOYMENT_TYPES = [
  "full_time",
  "contract",
  "contract_to_hire",
  "part_time",
] as const
/** Supported clearance requirement labels understood by hard filter. */
export const CLEARANCE_LEVELS = [
  "none",
  "public_trust",
  "secret",
  "top_secret",
] as const
/** Supported compensation intervals used by compensation normalization. */
export const COMPENSATION_INTERVALS = ["hourly", "monthly", "annual"] as const

/** Reference-only company type vocabulary for extractor/profile-loader consistency. */
export const COMPANY_TYPES = ["product", "consulting", "agency", "unknown"] as const
/** Reference-only skill category vocabulary for extracted and profile skills. */
export const SKILL_CATEGORIES = [
  "language",
  "framework",
  "cloud",
  "tool",
  "methodology",
  "domain",
] as const
/** Reference-only skill importance vocabulary expected from extractor outputs. */
export const SKILL_IMPORTANCES = ["must", "preferred"] as const
/** Reference-only confidence labels expected from `profile.json` skills. */
export const CONFIDENCE_LEVELS = ["expert", "strong", "familiar"] as const

/**
 * Hardcoded FX conversion factors into USD for coarse compensation filtering.
 *
 * Rates are intentionally static because filter needs rough accept/reject decisions,
 * not trading precision. Periodic manual updates are enough because max-of-range
 * logic already absorbs small weekly drift on major currencies.
 */
export const FX_TO_USD: Record<string, number> = {
  USD: 1.0,
  EUR: 1.08,
  GBP: 1.27,
  CAD: 0.73,
  INR: 0.012,
  AUD: 0.66,
}

/**
 * Enumerated filter and review flags shared with judge, router, and artifact stages.
 * Additions here require downstream consumers to understand new semantics explicitly.
 */
export const FLAGS = {
  SPONSORSHIP_UNCLEAR: "sponsorship_unclear",
  PAYMENT_MODEL_RESTRICTION: "payment_model_restriction",
  CLEARANCE_UNCLEAR: "clearance_unclear",
  REMOTE_UNCLEAR: "remote_unclear",
  EMPLOYMENT_TYPE_UNCLEAR: "employment_type_unclear",
  EDUCATION_UNPARSED: "education_unparsed",
  SENIORITY_ADJACENT: "seniority_adjacent",
  YEARS_EXPERIENCE_MISSING: "years_experience_missing",
  OVERQUALIFIED: "overqualified",
  COMPENSATION_MISSING: "compensation_missing",
  COMPENSATION_INTERVAL_MISSING: "compensation_interval_missing",
  CURRENCY_UNSUPPORTED: "currency_unsupported",
  SOURCE_SCORE_INVALID: "source_score_invalid",
  POSTED_AT_MISSING: "posted_at_missing",
  STALE_POSTING: "stale_posting",
  JUDGE_FAILED: "judge_failed",
  THIRD_PARTY_CONTRACT: "third_party_contract",
} as const

/**
 * Output buckets used by pipeline routing after filtering and judging.
 * Values map to artifact folder names and must remain stable for persistence code.
 */
export const BUCKETS = {
  COVER_LETTER: "cover_letter",
  RESULTS: "results",
  REVIEW_QUEUE: "review_queue",
  ARCHIVE: "archive",
} as const

/**
 * Optional per-source weight adjustments applied to upstream match scores.
 * Missing source keys intentionally mean zero adjustment.
 */
export const SOURCE_SCORE_WEIGHT_BY_SITE: Record<string, number> = {
  jobright: 0.1,
}
