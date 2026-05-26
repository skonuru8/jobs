export type Relationship =
  | "exact"
  | "reworded"
  | "direct_equivalent"
  | "adjacent"
  | "unsupported_inference"
  | "fabricated"
  | "fabricated_role_attribution";

export type FabricationRisk =
  | "none"
  | "low"
  | "medium"
  | "medium_high"
  | "high"
  | "critical";

export interface RiskEntry {
  target_skill:           string;
  candidate_source_skill: string;
  category:               string;
  relationship:           Relationship;
  truth_distance_score:   number;
  confidence:             number;
  fabrication_risk:       FabricationRisk;
  swap_allowed:           boolean;
  reframe_allowed:        boolean;
  requires_human_review:  boolean;
  evidence_basis?:        string;
  safe_language?:         string[];
  disallowed_claims?:     string[];
  interview_defense?:     string;
}

export interface RiskSummary {
  counts: {
    exact:                 number;
    reworded:              number;
    direct_equivalent:     number;
    adjacent:              number;
    unsupported_inference: number;
    fabricated:            number;
    fabricated_role_attribution: number;
  };
  human_review_items: Array<{
    text:         string;
    relationship: Relationship;
    reason:       string;
  }>;
  total_claims_audited: number;
}

export interface LedgerEntryInput {
  job_id:                   string;
  run_id:                   string | null;
  artifact_type:            "resume" | "cover_letter";
  jd_skill:                 string | null;
  canonical_skill_found:    string | null;
  generated_skill_or_claim: string;
  change_type:              Relationship;
  truth_distance_score:     number;
  fabrication_risk:         FabricationRisk;
  location:                 "summary" | "skills" | "experience" | "projects" | "unknown";
  human_review_required:    boolean;
}
