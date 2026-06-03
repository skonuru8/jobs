/**
 * types.ts — Deterministic scoring contracts for jobs, profiles, and results.
 *
 * Defines minimal normalized shapes that scoring stage consumes after extraction
 * and filtering. Keeps scorer decoupled from wider job/profile schemas so weight
 * calculations and gating logic operate on stable inputs.
 *
 * Called by: scorer implementation, filter pipeline, tests
 * Writes to: nothing
 * Side effects: none
 */

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** Canonical skill requirement from extracted job payload after normalization. */
export interface JobSkill {
  /** Human-readable skill label after normalization and synonym folding. */
  name: string;
  /** Minimum years requested by job, or `null` when JD does not specify duration. */
  years_required: number | null;
  /**
   * Requiredness tier used by scorer to weight coverage gaps:
   * - `required`      — core JD requirement; missing = significant score penalty
   * - `preferred`     — strong nice-to-have; partial credit if absent
   * - `nice_to_have`  — low-weight bonus; rarely decides outcome
   */
  importance: "required" | "preferred" | "nice_to_have";
  /** Broad skill bucket such as language, framework, cloud, or domain. */
  category: string;
}

/** Candidate skill row sourced from `profile.json`. */
export interface ProfileSkill {
  /** Human-readable skill label after profile normalization. */
  name: string;
  /** Self-reported years of hands-on use for this skill. */
  years: number;
  /**
   * Self-reported proficiency band, used as a tiebreaker when years are close:
   * - `expert`    — deep production experience; can lead and mentor
   * - `strong`    — solid day-to-day use; handles most scenarios independently
   * - `familiar`  — working knowledge; needs ramp-up for complex tasks
   */
  confidence: "expert" | "strong" | "familiar";
  /** Broad skill bucket aligned with job skill categories when possible. */
  category: string;
}

/** Location constraints projected into simple arrays for deterministic comparison. */
export interface LocationInfo {
  /** Work arrangement label, usually `remote`, `hybrid`, `onsite`, or `null` when unknown. */
  type: string | null;
  /** Normalized city names accepted or extracted for this entity. */
  cities: string[];
  /** Normalized country names accepted or extracted for this entity. */
  countries: string[];
}

/** Minimal extracted job payload scorer needs after earlier pipeline stages. */
export interface ScoringJobInput {
  /** Job title after extractor cleanup. */
  title: string;
  /** Parsed seniority band, or `null` when JD language is inconclusive. */
  seniority: string | null;
  /** Employment model such as full-time or contract, or `null` when missing. */
  employment_type: string | null;
  /** Parsed location constraints for deterministic matching. */
  location: LocationInfo;
  /** Skill requirements ordered and normalized by extractor/filter stages. */
  required_skills: JobSkill[];
  /** Parsed experience range in years; missing bounds stay `null`. */
  years_experience: {
    /** Minimum years required, or `null` when absent. */
    min: number | null;
    /** Maximum years mentioned, or `null` when absent. */
    max: number | null;
  };
  /** Parsed compensation floor and units used by compensation gate heuristics. */
  compensation: {
    /** Minimum numeric compensation, or `null` when omitted. */
    min: number | null;
    /** ISO-like currency code, or `null` when extractor cannot resolve it. */
    currency: string | null;
    /** Interval such as annual or hourly, or `null` when missing. */
    interval: string | null;
  };
}

/** Minimal profile subset scorer needs to compare candidate fit against job. */
export interface ScoringProfileInput {
  /** Seniority bands user is willing to target. */
  acceptable_seniority: string[];
  /** Employment models user accepts for this search. */
  acceptable_employment: string[];
  /** Candidate location preferences and relocation flexibility. */
  location: {
    /** Allowed work arrangements such as remote, hybrid, or onsite. */
    acceptable_types: string[];
    /** Preferred or accepted cities for onsite or hybrid roles. */
    acceptable_cities: string[];
    /** Preferred or accepted countries for role location. */
    acceptable_countries: string[];
    /** Whether scorer may treat non-listed locations as potentially acceptable. */
    willing_to_relocate: boolean;
  };
  /** Candidate compensation floor expressed in profile currency and interval. */
  compensation: {
    /** Minimum acceptable compensation in stated currency and interval. */
    min_acceptable: number;
    /** Currency code corresponding to `min_acceptable`. */
    currency: string;
    /** Compensation interval such as annual or hourly. */
    interval: string;
  };
  /** Candidate skills used for overlap and years-of-experience scoring. */
  skills: ProfileSkill[];
  /** Total professional years used for coarse experience matching. */
  years_experience: number;
}

// ---------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------

/**
 * Weights applied to each deterministic scoring component.
 * Values should sum to 1 in normal configs, but scorer validates that separately.
 */
export interface ScoringWeights {
  /** Relative importance of direct skill overlap score. */
  skills: number;
  /** Relative importance of semantic similarity score when embeddings exist. */
  semantic: number;
  /** Relative importance of years-of-experience match score. */
  yoe: number;
  /** Relative importance of seniority compatibility score. */
  seniority: number;
  /** Relative importance of location compatibility score. */
  location: number;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** Breakdown of individual scoring components. */
export interface ScoreComponents {
  /** Skill overlap subscore in normalized 0-1 range. */
  skills: number;
  /** Semantic similarity subscore in 0-1 range; 0 when embeddings unavailable. */
  semantic: number;
  /** Years-of-experience subscore in normalized 0-1 range. */
  yoe: number;
  /** Seniority compatibility subscore in normalized 0-1 range. */
  seniority: number;
  /** Location compatibility subscore in normalized 0-1 range. */
  location: number;
}

/** Full scoring result. */
export interface ScoreResult {
  /** Final weighted composite in normalized 0-1 range. */
  score: number;
  /** Whether `score` meets or exceeds caller-provided threshold. */
  gate_passed: boolean;
  /** Raw component scores before final weighted aggregation. */
  components: ScoreComponents;
  /** Weights used to compute final composite for traceability. */
  weights: ScoringWeights;
  /** Gate threshold used for `gate_passed` decision. */
  threshold: number;
}
