/**
 * types.ts — Shared types for tailored-artifact fabrication and attribution risk.
 *
 * Defines relationship enums, ledger row shapes, and summary objects used by the
 * risk-map audit pass and downstream persistence. These contracts keep risk scoring,
 * human-review gating, and storage aligned across resume and cover-letter flows.
 *
 * Called by: risk-map/audit.ts, storage persistence, reporting consumers
 * Writes to: nothing
 * Side effects: none
 */

/**
 * How a skill or claim in generated artifact relates to candidate's canonical resume.
 */
export type Relationship =
  /** Verbatim or near-verbatim match to canonical source text. */
  | "exact"
  /** Same concept as canonical source, but phrased differently. */
  | "reworded"
  /** Approved technology equivalence swap that remains interview-defensible. */
  | "direct_equivalent"
  /** Related domain concept that should be reframed, not presented as direct match. */
  | "adjacent"
  /** Inference drawn from context rather than explicit canonical evidence. */
  | "unsupported_inference"
  /** Claim has no canonical source and was generated to fill job-description gap. */
  | "fabricated"
  /** Claim is attached to role where canonical resume never places that experience. */
  | "fabricated_role_attribution";

/**
 * Fabrication risk level assigned to audited claim before artifact ships.
 */
export type FabricationRisk =
  /** Direct canonical support exists, so claim carries no fabrication exposure. */
  | "none"
  /** Low-risk tech-equivalence swap that remains defensible under questioning. */
  | "low"
  /** Adjacent concept that requires reframing and should not be presented as direct experience. */
  | "medium"
  /** Unsupported inference that needs cautionary language or human judgment. */
  | "medium_high"
  /** Fabricated claim with no canonical source; human review required. */
  | "high"
  /** Highest-risk claim that also violates explicit disallowed-claim rules. */
  | "critical";

export interface RiskEntry {
  /** Job-description skill or claim this mapping evaluates. */
  target_skill:           string;
  /** Canonical source skill that can justify target, when one exists. */
  candidate_source_skill: string;
  /** Mapping bucket used to group related risk decisions. */
  category:               string;
  /** Semantic relationship between generated claim and canonical evidence. */
  relationship:           Relationship;
  /** Distance from canonical truth on 0-5 scale, where higher means riskier fabrication. */
  truth_distance_score:   number;
  /** Confidence in mapping quality on 0-1 scale. */
  confidence:             number;
  /** Operational fabrication severity used for gating and reporting. */
  fabrication_risk:       FabricationRisk;
  /** Whether automated tech-swap logic may substitute this claim directly. */
  swap_allowed:           boolean;
  /** Whether safer reframing is allowed even when direct swap is not. */
  reframe_allowed:        boolean;
  /** Whether artifact must be surfaced for human review before shipping. */
  requires_human_review:  boolean;
  /** Short rationale describing why mapping is defensible or risky. */
  evidence_basis?:        string;
  /** Safer phrasings that reduce overclaiming risk when present. */
  safe_language?:         string[];
  /** Claims that must never appear alongside this mapping. */
  disallowed_claims?:     string[];
  /** Interview-safe explanation candidate can use if claim is challenged. */
  interview_defense?:     string;
}

export interface RiskSummary {
  /** Per-relationship counts found during audit pass. */
  counts: {
    /** Number of verbatim or near-verbatim matches to canonical source. */
    exact:                 number;
    /** Number of concept-preserving rewrites. */
    reworded:              number;
    /** Number of approved direct-equivalence tech swaps. */
    direct_equivalent:     number;
    /** Number of adjacent-but-not-equal claims requiring reframing. */
    adjacent:              number;
    /** Number of context-based inferences lacking explicit source support. */
    unsupported_inference: number;
    /** Number of wholly fabricated skills or claims. */
    fabricated:            number;
    /** Number of claims attached to wrong role or employer context. */
    fabricated_role_attribution: number;
  };
  /** Claims that need explicit human review before release. */
  human_review_items: Array<{
    /** User-facing text of risky skill or claim. */
    text:         string;
    /** Relationship classification that triggered review. */
    relationship: Relationship;
    /** Reason reviewer should inspect this item. */
    reason:       string;
  }>;
  /** Total number of claims audited across all relationship buckets. */
  total_claims_audited: number;
}

export interface LedgerEntryInput {
  /** Job identifier tying audit row back to application record. */
  job_id:                   string;
  /** Pipeline run identifier when audit happens inside run folder flow. */
  run_id:                   string | null;
  /** Which artifact type this ledger row belongs to. */
  artifact_type:            "resume" | "cover_letter";
  /** Job-description skill being evaluated, or `null` for role-attribution findings. */
  jd_skill:                 string | null;
  /** Canonical evidence matched to claim, or `null` when no support exists. */
  canonical_skill_found:    string | null;
  /** Final generated claim text that entered audit ledger. */
  generated_skill_or_claim: string;
  /** Relationship classification recorded for persistence and reporting. */
  change_type:              Relationship;
  /** 0 = identical to canonical; 1 = completely fabricated. */
  truth_distance_score:     number;
  /** Fabrication severity written to ledger for downstream gating. */
  fabrication_risk:         FabricationRisk;
  /** Which resume section the claim appeared in. */
  location:                 "summary" | "skills" | "experience" | "projects" | "unknown";
  /** Whether reviewer must approve this row before artifact is trusted. */
  human_review_required:    boolean;
}
