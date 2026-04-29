/**
 * types.ts — scorer input/output types.
 * Bible §5 stage 11 (deterministic scoring) + §12 milestone 3.
 */

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** Canonical skill from an extracted job (post-normalize). */
export interface JobSkill {
    name:           string;
    years_required: number | null;
    importance:     "required" | "preferred" | "nice_to_have";
    category:       string;
  }
  
  /** Profile skill from profile.json. */
  export interface ProfileSkill {
    name:       string;
    years:      number;
    confidence: "expert" | "strong" | "familiar";
    category:   string;
  }
  
  /** Location from job or profile. */
  export interface LocationInfo {
    type:      string | null;   // "remote" | "hybrid" | "onsite" | null
    cities:    string[];
    countries: string[];
  }
  
  /** Minimal job fields needed for scoring (post-extraction). */
  export interface ScoringJobInput {
    title:            string;
    seniority:        string | null;
    employment_type:  string | null;
    location:         LocationInfo;
    required_skills:  JobSkill[];
    years_experience: { min: number | null; max: number | null };
    compensation:     { min: number | null; currency: string | null; interval: string | null };
  }
  
  /** Minimal profile fields needed for scoring. */
  export interface ScoringProfileInput {
    acceptable_seniority:  string[];
    acceptable_employment: string[];
    location: {
      acceptable_types:     string[];
      acceptable_cities:    string[];
      acceptable_countries: string[];
      willing_to_relocate:  boolean;
    };
    compensation: {
      min_acceptable: number;
      currency:       string;
      interval:       string;
    };
    skills:           ProfileSkill[];
    years_experience: number;
  }
  
  // ---------------------------------------------------------------------------
  // Weights
  // ---------------------------------------------------------------------------
  
  export interface ScoringWeights {
    skills:    number;
    semantic:  number;
    yoe:       number;
    seniority: number;
    location:  number;
  }
  
  // ---------------------------------------------------------------------------
  // Output
  // ---------------------------------------------------------------------------
  
  /** Breakdown of individual scoring components. */
  export interface ScoreComponents {
    skills:    number;   // 0–1
    semantic:  number;   // 0–1  (0 if embeddings not available)
    yoe:       number;   // 0–1
    seniority: number;   // 0–1
    location:  number;   // 0–1
  }
  
  /** Full scoring result. */
  export interface ScoreResult {
    score:        number;         // 0–1 weighted composite
    gate_passed:  boolean;        // score >= threshold
    components:   ScoreComponents;
    weights:      ScoringWeights;
    threshold:    number;
  }