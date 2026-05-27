/**
 * types.ts — input/output types for the LLM judge stage.
 * Bible §5 stages 13–14.
 */

import type { Profile, VisaSponsorshipStatus } from "@/filter/types";

// ---------------------------------------------------------------------------
// Judge inputs
// ---------------------------------------------------------------------------

export interface JudgeSkill {
  name:           string;
  importance:     string;
  years_required: number | null;
}

export interface JudgeJobInput {
  title:             string;
  company:           string;
  employment_type:   string | null;
  seniority:         string | null;
  domain:            string | null;
  required_skills:   JudgeSkill[];
  years_experience:  { min: number | null; max: number | null };
  education_required: { minimum: string; field: string };
  visa_sponsorship:  VisaSponsorshipStatus;
  visa_quote:        string | null;
  responsibilities:  string[];
  flags:             string[];
}

export interface JudgeScoreInput {
  total: number;
  components: {
    skills:    number;
    semantic:  number;
    yoe:       number;
    seniority: number;
    location:  number;
  };
}

export interface JudgeInput {
  job:   JudgeJobInput;
  score: JudgeScoreInput;
  /** Optional identifiers for validation-failure payload capture. */
  run_id?: string | null;
  job_id?: string | null;
  /** When set, system prompt uses live profile instead of a static template. */
  profile?: Profile;
  /** Work-history lines extracted from canonical resume TeX. */
  roles_list?: string;
  /** SKILLS section text from canonical resume TeX — prevents judge from flagging known skills as gaps. */
  canonical_skills?: string;
}

// ---------------------------------------------------------------------------
// Judge outputs
// ---------------------------------------------------------------------------

export type JudgeVerdict = "STRONG" | "MAYBE" | "WEAK";
export type GapHandling = "fabricate" | "reframe" | "acknowledge" | "ignore" | "forbid";

export interface JudgeGap {
  requirement:   string;
  severity:        "minor" | "moderate" | "major";
  reframe_angle:   string;
}

export interface GapDirective {
  jd_requirement: string;
  handling: GapHandling;
  target_role: string | null;
  frame_as: string | null;
}

export interface TechSwap {
  from: string;
  to: string;
  confidence: number;
  target_role: string | null;
}

export interface TailoringHints {
  emphasize_roles:      string[];
  emphasize_skills:     string[];
  downplay_skills:      string[];
  domain_reframe_angle: string | null;
  tech_swaps:           TechSwap[];
  /**
   * Storage mirror for v5 gap directives so DB round-trips stay additive
   * without needing a new judge_verdicts column.
   */
  gap_directives:       GapDirective[];
}

export interface JudgeFields {
  verdict:   JudgeVerdict;
  reasoning: string;
  concerns:  string[];

  confidence:      number | null;
  key_matches:     string[];
  gaps:            JudgeGap[];
  gap_directives:  GapDirective[];
  why_apply:       string | null;
  tailoring_hints: TailoringHints;
}

export interface JudgeResult {
  status:         "ok" | "error";
  fields:         JudgeFields | null;
  verdict:        JudgeVerdict | null;
  model:          string;
  prompt_version: string;
  /** SHA-256 (12 hex) of the dynamic system prompt sent to the model. */
  system_prompt_sha?: string;
  judged_at:      string;
  error?:         string;
}

// ---------------------------------------------------------------------------
// Routing — final bucket after judge verdict
// ---------------------------------------------------------------------------

export type FinalBucket =
  | "COVER_LETTER"   // STRONG + score >= 0.70
  | "RESULTS"        // STRONG + score < 0.70
  | "REVIEW_QUEUE"   // MAYBE
  | "ARCHIVE";       // WEAK or judge error
