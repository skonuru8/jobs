/**
 * types.ts — input/output types for the LLM judge stage.
 * Bible §5 stages 13–14.
 */

import type { Profile } from "@/filter/types";

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
  visa_sponsorship:  boolean | null;
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
  /** When set, system prompt uses live profile instead of a static template. */
  profile?: Profile;
  /** Work-history lines extracted from canonical resume TeX. */
  roles_list?: string;
}

// ---------------------------------------------------------------------------
// Judge outputs
// ---------------------------------------------------------------------------

export type JudgeVerdict = "STRONG" | "MAYBE" | "WEAK";

export interface JudgeGap {
  requirement:   string;
  severity:        "minor" | "moderate" | "major";
  reframe_angle:   string;
}

export interface JudgeFields {
  verdict:   JudgeVerdict;
  reasoning: string;
  concerns:  string[];

  confidence?:      number;
  key_matches?:     string[];
  gaps?:            JudgeGap[];
  why_apply?:       string;
  tailoring_hints?: {
    emphasize_roles?:      string[];
    emphasize_skills?:     string[];
    downplay_skills?:      string[];
    domain_reframe_angle?: string;
  };
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
