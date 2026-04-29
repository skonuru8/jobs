/**
 * components.ts — pure deterministic scoring functions.
 * Bible §5 stage 11. Weights: skills 0.35 | semantic 0.25 | YOE 0.15 | seniority 0.15 | location 0.10.
 *
 * Design rules:
 * - Pure functions only. No I/O, no side effects.
 * - Unknown job-side values → partial credit (not zero), matches filter philosophy.
 * - Underqualified worse than overqualified (asymmetric YOE).
 * - All return [0, 1].
 */

import { JobSkill, ProfileSkill, LocationInfo } from "./types.js";

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

/**
 * Weighted Jaccard-style skill overlap.
 *
 * Weight per skill is importance × confidence:
 *   importance:  required=1.0  preferred=0.6  nice_to_have=0.3
 *   confidence:  expert=1.0    strong=0.7     familiar=0.4
 *
 * Score = (sum of weights for matched skills) / (sum of weights for ALL job required+preferred skills)
 *
 * Nice-to-have skills contribute to numerator only — missing them doesn't penalize.
 * Required skills the profile lacks drop the denominator weight in, hurting the score.
 *
 * THIN-EXTRACTION CEILING:
 *   When a JD has fewer than THIN_EXTRACTION_THRESHOLD required+preferred skills,
 *   cap the score at THIN_EXTRACTION_CEILING. Prevents scenarios where a JD with
 *   4 extracted skills (all matching the profile) scores 1.0 while a JD with 40
 *   realistic skills scores 0.5. Four skills isn't enough signal to claim a
 *   great match — flag it for the LLM judge to resolve.
 *
 * Edge cases:
 *   - No required/preferred job skills → 1.0 (no bar to clear)
 *   - Profile has all required skills  → full credit from those
 */
const THIN_EXTRACTION_THRESHOLD = 6;   // jobs with fewer r+p skills trigger ceiling
const THIN_EXTRACTION_CEILING   = 0.85;

export function scoreSkills(
  jobSkills:     JobSkill[],
  profileSkills: ProfileSkill[],
): number {
  if (!jobSkills.length) return 1.0;

  // Build profile skill lookup (canonical name → confidence weight)
  const profileMap = new Map<string, number>();
  for (const ps of profileSkills) {
    const key = ps.name.trim().toLowerCase();
    profileMap.set(key, _confidenceWeight(ps.confidence));
  }

  const IMPORTANCE_WEIGHT: Record<string, number> = {
    required:     1.0,
    preferred:    0.6,
    nice_to_have: 0.3,
  };

  let denominator      = 0;
  let numerator        = 0;
  let coreSkillCount   = 0;   // required + preferred count (for thin-extraction detection)

  for (const js of jobSkills) {
    const importance = IMPORTANCE_WEIGHT[js.importance] ?? 0.5;
    const jobWeight  = importance;

    // Only required + preferred go in the denominator (form the "bar")
    if (js.importance !== "nice_to_have") {
      denominator += jobWeight;
      coreSkillCount++;
    }

    const key = js.name.trim().toLowerCase();
    if (profileMap.has(key)) {
      const confWeight = profileMap.get(key)!;
      // Numerator credit = importance × confidence (partial credit for familiar)
      numerator += jobWeight * confWeight;
    }
  }

  if (denominator === 0) return 1.0;   // no required/preferred → no bar

  const raw = Math.min(numerator / denominator, 1.0);

  // Cap thin extractions — too few skills means we can't confidently claim a strong match
  if (coreSkillCount < THIN_EXTRACTION_THRESHOLD) {
    return Math.min(raw, THIN_EXTRACTION_CEILING);
  }

  return raw;
}


// ---------------------------------------------------------------------------
// YOE (years of experience)
// ---------------------------------------------------------------------------

/**
 * Score years-of-experience fit. Asymmetric: underqualified hurts more.
 *
 * Cases:
 *   job YOE unknown       → 0.75 (benefit of doubt)
 *   profile within range  → 1.0
 *   profile over max      → soft penalty (overqualified but hirable)
 *   profile under min     → hard penalty (underqualified)
 *
 * Penalty curves:
 *   Underqualified gap g: max(0, 1 - g * 0.2)   (5yr gap → 0.0)
 *   Overqualified  gap g: max(0.4, 1 - g * 0.1)  (floor at 0.4)
 */
export function scoreYOE(
  jobYOEMin:   number | null,
  jobYOEMax:   number | null,
  profileYOE:  number,
): number {
  // Job doesn't state YOE
  if (jobYOEMin === null && jobYOEMax === null) return 0.75;

  const lo = jobYOEMin ?? 0;
  const hi = jobYOEMax ?? Infinity;

  // Within range
  if (profileYOE >= lo && profileYOE <= hi) return 1.0;

  // Underqualified
  if (profileYOE < lo) {
    const gap = lo - profileYOE;
    return Math.max(0, 1 - gap * 0.2);
  }

  // Overqualified
  const gap = profileYOE - hi;
  return Math.max(0.4, 1 - gap * 0.1);
}


// ---------------------------------------------------------------------------
// Seniority
// ---------------------------------------------------------------------------

const SENIORITY_LEVELS: Record<string, number> = {
  intern:    0,
  junior:    1,
  mid:       2,
  senior:    3,
  staff:     4,
  lead:      4,
  principal: 5,
  manager:   4,
};

/**
 * Score seniority match by ordinal distance from the profile's acceptable range.
 *
 * If job seniority is within acceptable range    → 1.0
 * If job seniority is null/unknown              → 0.6 (flag already set upstream)
 * If 1 level outside range                      → 0.5
 * If 2+ levels outside range                   → 0.0
 */
export function scoreSeniority(
  jobSeniority:        string | null,
  profileAcceptable:   string[],
): number {
  if (!jobSeniority || !(jobSeniority in SENIORITY_LEVELS)) return 0.6;

  const jobLevel = SENIORITY_LEVELS[jobSeniority];
  const acceptableLevels = profileAcceptable
    .filter(s => s in SENIORITY_LEVELS)
    .map(s => SENIORITY_LEVELS[s]);

  if (!acceptableLevels.length) return 0.6;

  // Within acceptable set
  if (acceptableLevels.includes(jobLevel)) return 1.0;

  // Distance from nearest acceptable level
  const minDist = Math.min(...acceptableLevels.map(l => Math.abs(l - jobLevel)));
  if (minDist === 1) return 0.5;
  return 0.0;
}


// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

/**
 * Score location compatibility.
 *
 * Binary-ish with grace for unknowns:
 *   job type matches profile acceptable types  → 1.0
 *   job type is null                           → 0.5 (flag already set)
 *   remote job, profile accepts remote         → 1.0
 *   onsite job, acceptable city match          → 1.0
 *   onsite job, wrong city, no relocate        → 0.0
 *   onsite job, wrong city, willing_to_relocate→ 0.4
 *   hybrid, acceptable types + city            → 1.0
 *   hybrid, wrong city                         → 0.3
 */
export function scoreLocation(
  jobLocation:  LocationInfo,
  profileLoc:   {
    acceptable_types:     string[];
    acceptable_cities:    string[];
    acceptable_countries: string[];
    willing_to_relocate:  boolean;
  },
): number {
  const { type, cities, countries } = jobLocation;
  const { acceptable_types, acceptable_cities, acceptable_countries, willing_to_relocate } = profileLoc;

  // Unknown type
  if (!type) return 0.5;

  // Type not in acceptable
  if (!acceptable_types.includes(type)) return 0.0;

  // Remote — type match is sufficient
  if (type === "remote") return 1.0;

  // Hybrid or onsite — check city
  const jobCitiesLower     = cities.map((c: string) => c.toLowerCase());
  const acceptCitiesLower  = acceptable_cities.map((c: string) => c.toLowerCase());
  const jobCountriesLower  = countries.map((c: string) => c.toLowerCase());
  const acceptCountriesLower = acceptable_countries.map((c: string) => c.toLowerCase());

  // No city preference — match on country only.
  // Empty acceptable_cities means "anywhere in acceptable countries is fine."
  if (acceptCitiesLower.length === 0) {
    // No country info on one side → give benefit of the doubt
    if (acceptCountriesLower.length === 0 || jobCountriesLower.length === 0) {
      return type === "hybrid" ? 0.7 : 0.5;
    }
    const countryMatch = jobCountriesLower.some(c => acceptCountriesLower.includes(c));
    if (countryMatch) return 1.0;
    return willing_to_relocate ? 0.4 : 0.0;
  }

  const cityMatch = jobCitiesLower.some((c: string) => acceptCitiesLower.includes(c));

  if (cityMatch) return 1.0;

  // No city info on job → partial credit
  if (!cities.length) return type === "hybrid" ? 0.7 : 0.5;

  // City mismatch
  if (type === "hybrid") return willing_to_relocate ? 0.5 : 0.3;
  return willing_to_relocate ? 0.4 : 0.0;
}


// ---------------------------------------------------------------------------
// Semantic (cosine similarity of embeddings)
// ---------------------------------------------------------------------------

/**
 * Score semantic similarity between two embedding vectors.
 * Returns cosine similarity clamped to [0, 1].
 *
 * Pass in Float32Arrays from embed.ts.
 * Returns 0 if either vector is empty/null — caller should handle gracefully.
 */
export function scoreSemantic(
  jobEmbedding:     Float32Array | null,
  profileEmbedding: Float32Array | null,
): number {
  if (!jobEmbedding || !profileEmbedding) return 0;
  if (jobEmbedding.length !== profileEmbedding.length) return 0;

  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < jobEmbedding.length; i++) {
    dot   += jobEmbedding[i] * profileEmbedding[i];
    normA += jobEmbedding[i] ** 2;
    normB += profileEmbedding[i] ** 2;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;

  // Cosine can be negative for dissimilar vectors — clamp to 0
  return Math.max(0, dot / denom);
}


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _confidenceWeight(confidence: string): number {
  const map: Record<string, number> = {
    expert:   1.0,
    strong:   0.7,
    familiar: 0.4,
  };
  return map[confidence] ?? 0.5;
}