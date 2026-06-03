/**
 * How a skill/claim in the generated artifact relates to the candidate's canonical resume:
 *
 * - `exact`                      — verbatim or near-verbatim match; no risk
 * - `reworded`                   — same concept, different phrasing; no risk
 * - `direct_equivalent`          — known tech swap (e.g. AWS S3 → Azure Blob); low risk; defensible
 * - `adjacent`                   — related domain but not the same skill; reframe only, no swap
 * - `unsupported_inference`      — drawn from context but not explicitly stated; medium-high risk
 * - `fabricated`                 — no source in canonical; generated to fill a JD gap; high risk
 * - `fabricated_role_attribution`— bullet attributed to a role where it doesn't appear in canonical
 */
export type Relationship =
  | "exact"
  | "reworded"
  | "direct_equivalent"
  | "adjacent"
  | "unsupported_inference"
  | "fabricated"
  | "fabricated_role_attribution";

/**
 * Fabrication risk level for a skill/claim in the audit ledger:
 * - `none`        — direct source in canonical; no exposure
 * - `low`         — direct_equivalent swap; defensible in interview
 * - `medium`      — adjacent relationship; reframe required, swap disallowed
 * - `medium_high` — unsupported_inference; needs disclosure in cover or caution
 * - `high`        — fabricated claim; no canonical source; requires human review
 * - `critical`    — fabricated + disallowed_claims violated; must not ship
 */
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
  /** Which artifact type this ledger row belongs to. */
  artifact_type:            "resume" | "cover_letter";
  jd_skill:                 string | null;
  canonical_skill_found:    string | null;
  generated_skill_or_claim: string;
  change_type:              Relationship;
  /** 0 = identical to canonical; 1 = completely fabricated. */
  truth_distance_score:     number;
  fabrication_risk:         FabricationRisk;
  /** Which resume section the claim appeared in. */
  location:                 "summary" | "skills" | "experience" | "projects" | "unknown";
  human_review_required:    boolean;
}
