/**
 * types.ts — contracts for judge-stage inputs, outputs, and routing decisions.
 *
 * Defines shape of scorer data sent into judge prompt, structured JSON fields
 * expected back from model, and final bucket values consumed by downstream
 * resume and cover-letter stages.
 *
 * Called by: judge.ts, prompt.ts, run-pipeline.ts, judge tests
 * Side effects: none; type-only module for cross-stage contracts
 */

import type { Profile, VisaSponsorshipStatus } from "@/filter/types";

// ---------------------------------------------------------------------------
// Judge inputs
// ---------------------------------------------------------------------------

export interface JudgeSkill {
  /** JD skill label exactly as extracted from posting text. */
  name:           string;
  /** Relative importance label from extraction, such as `required` or `preferred`. */
  importance:     string;
  /** Minimum years requested for this skill, or `null` when JD gave no number. */
  years_required: number | null;
}

export interface JudgeJobInput {
  /** Human-readable job title shown to judge and stored in failure payloads. */
  title:             string;
  /** Employer or staffing-firm name attached to posting. */
  company:           string;
  /** Normalized employment type from filter stage, or `null` when unavailable. */
  employment_type:   string | null;
  /** Normalized seniority label from parser, or `null` when JD did not specify one. */
  seniority:         string | null;
  /** Domain or industry hint used for fit reasoning, or `null` when absent. */
  domain:            string | null;
  /** Capped required-skill list judge uses for fit and gap analysis. */
  required_skills:   JudgeSkill[];
  /** Parsed JD experience range; `null` bounds mean requirement was not explicit. */
  years_experience:  { min: number | null; max: number | null };
  /** Minimum degree and field expectations pulled from posting text. */
  education_required: { minimum: string; field: string };
  /** Sponsorship classification from hard-filter stage; only `denied` is auto-WEAK. */
  visa_sponsorship:  VisaSponsorshipStatus;
  /** Verbatim sponsorship quote for auditability when classification is ambiguous. */
  visa_quote:        string | null;
  /** Representative JD responsibility lines included in user prompt context. */
  responsibilities:  string[];
  /** Parser or filter flags judge should treat as context, not independent verdicts. */
  flags:             string[];
}

export interface JudgeScoreInput {
  /** Final deterministic pre-judge score on 0-1 scale. */
  total: number;
  /** Individual normalized scorer components that explain why gate passed. */
  components: {
    /** Required-skill overlap score before semantic compensation. */
    skills:    number;
    /** Embedding/semantic similarity score for adjacent-stack detection. */
    semantic:  number;
    /** Years-of-experience alignment score against JD minimum/maximum. */
    yoe:       number;
    /** Seniority alignment score for title/level fit. */
    seniority: number;
    /** Location compatibility score after filter normalization. */
    location:  number;
  };
}

export interface JudgeInput {
  /** Normalized job facts and extracted requirements to evaluate. */
  job:   JudgeJobInput;
  /** Deterministic scorer output judge treats as prior context, not something to recompute. */
  score: JudgeScoreInput;
  /** Optional identifiers for validation-failure payload capture. */
  run_id?: string | null;
  job_id?: string | null;
  /** Candidate profile used to build system prompt. Required at all production call sites. */
  profile: Profile;
  /** Work-history lines extracted from canonical resume TeX. */
  roles_list?: string;
  /** SKILLS section text from canonical resume TeX — prevents judge from flagging known skills as gaps. */
  canonical_skills?: string;
  /** Exact role labels from parser — judge target_role must match one of these verbatim. */
  allowed_role_labels?: string[];
}

// ---------------------------------------------------------------------------
// Judge outputs
// ---------------------------------------------------------------------------

/**
 * Final judge verdict before pipeline routing.
 */
export type JudgeVerdict =
  /** Clear fit worth tailoring and usually worth applying immediately. */
  | "STRONG"
  /** Ambiguous fit that may still deserve review or artifact generation. */
  | "MAYBE"
  /** Poor fit or hard blocker that should stop artifact work. */
  | "WEAK";

/**
 * Strategy downstream generators should use for a missing JD requirement.
 */
export type GapHandling =
  /** Add new resume evidence at `target_role` because role context can plausibly support it. */
  | "fabricate"
  /** Rewrite existing resume evidence to surface adjacent experience honestly. */
  | "reframe"
  /** Leave resume untouched and address gap explicitly in cover letter language. */
  | "acknowledge"
  /** Omit gap from both artifacts because it is not worth spending space on. */
  | "ignore"
  /** Ban claim entirely because requirement would be dishonest or disqualifying. */
  | "forbid";

export interface JudgeGap {
  /** Exact JD requirement or capability the candidate does not clearly satisfy. */
  requirement:   string;
  /** Severity estimate that tells downstream stages whether gap is cosmetic or deal-breaking. */
  severity:
    /** Nice-to-have miss that should rarely decide verdict alone. */
    | "minor"
    /** Meaningful miss that may require human judgment or careful reframing. */
    | "moderate"
    /** Core-stack or hard-signal miss that should weigh heavily in verdict. */
    | "major";
  /** Honest adjacent angle judge suggests when writer needs to discuss this gap. */
  reframe_angle:   string;
}

export interface GapDirective {
  /** Exact JD term this directive covers; must be traceable back to posting text. */
  jd_requirement: string;
  /** Downstream handling mode for this requirement gap. */
  handling: GapHandling;
  /** Exact role header to target, or `null` when no resume role should change. */
  target_role: string | null;
  /** Multi-sentence writer brief for resume or cover-letter treatment, or `null` when unused. */
  frame_as: string | null;
}

export interface TechSwap {
  /** Candidate skill already present in canonical resume and safe to foreground. */
  from: string;
  /** JD-facing equivalent term generator may substitute into tailored artifact. */
  to: string;
  /** Risk-map confidence on 0-1 scale for how defensible this equivalence is. */
  confidence: number;
  /** Optional exact role scope for swap; `null` means swap is globally defensible. */
  target_role: string | null;
}

export interface TailoringHints {
  /** Exact resume role labels that should lead tailored resume emphasis. */
  emphasize_roles:      string[];
  /** Profile skills worth surfacing prominently because they map to JD priorities. */
  emphasize_skills:     string[];
  /** Resume skills to de-emphasize because they distract from target posting. */
  downplay_skills:      string[];
  /** Honest domain bridge for candidate narrative when JD industry differs. */
  domain_reframe_angle: string | null;
  /** Defensible skill-name substitutions approved by risk map. */
  tech_swaps:           TechSwap[];
  /**
   * Storage mirror for v5 gap directives so DB round-trips stay additive
   * without needing a new judge_verdicts column.
   */
  gap_directives:       GapDirective[];
}

export interface JudgeFields {
  /** Final verdict chosen by model after reading profile, scorer context, and JD facts. */
  verdict:   JudgeVerdict;
  /** Short human-readable rationale stored in DB and UI surfaces. */
  reasoning: string;
  /** Explicit caveats or blockers caller should preserve verbatim. */
  concerns:  string[];

  /** Model confidence in verdict on 0-1 scale, or `null` when validation allowed omission. */
  confidence:      number | null;
  /** Specific role-to-requirement strengths that justify verdict. */
  key_matches:     string[];
  /** Structured requirement misses extracted from judgment. */
  gaps:            JudgeGap[];
  /** Actionable instructions for resume/cover-letter tailoring stage. */
  gap_directives:  GapDirective[];
  /** Short personalized answer for "why this role/company?" if one exists. */
  why_apply:       string | null;
  /** Resume-generation hints derived from judge analysis and risk-map policy. */
  tailoring_hints: TailoringHints;
}

export interface JudgeResult {
  /** `ok` when validation succeeded; `error` when LLM call or schema validation failed. */
  status:         "ok" | "error";
  /** Parsed structured judge payload on success; `null` on failures. */
  fields:         JudgeFields | null;
  /** Convenience copy of final verdict for routing without reopening `fields`. */
  verdict:        JudgeVerdict | null;
  /** Actual model identifier returned by provider or requested in fallback path. */
  model:          string;
  /** Prompt-contract version for auditability across schema changes. */
  prompt_version: string;
  /** SHA-256 (12 hex) of the dynamic system prompt sent to the model. */
  system_prompt_sha?: string;
  /** ISO timestamp for when judge stage executed. */
  judged_at:      string;
  /** Human-readable failure reason when `status` is `error`. */
  error?:         string;
  /** Total prompt tokens consumed across all judge LLM calls for this result. */
  input_tokens?:  number;
  /** Total completion tokens consumed across all judge LLM calls for this result. */
  output_tokens?: number;
}

// ---------------------------------------------------------------------------
// Routing — final bucket after judge verdict
// ---------------------------------------------------------------------------

/**
 * Final routing bucket after score and judge verdict are combined.
 */
export type FinalBucket =
  /** Strong fit with score high enough to generate resume and cover-letter artifacts. */
  | "COVER_LETTER"
  /** Strong fit below artifact threshold; still surfaced in results list. */
  | "RESULTS"
  /** Maybe-fit queue for manual review and threshold-gated artifact generation. */
  | "REVIEW_QUEUE"
  /** Rejected or failed-judge bucket that suppresses artifact work. */
  | "ARCHIVE";
