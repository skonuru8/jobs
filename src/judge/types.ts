/**
 * types.ts — input/output types for the LLM judge stage.
 * Bible §5 stages 13–14.
 */

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
}

// ---------------------------------------------------------------------------
// Judge outputs
// ---------------------------------------------------------------------------

export type JudgeVerdict = "STRONG" | "MAYBE" | "WEAK";

export interface JudgeFields {
  verdict:   JudgeVerdict;
  reasoning: string;
  concerns:  string[];
}

export interface JudgeResult {
  status:         "ok" | "error";
  fields:         JudgeFields | null;
  verdict:        JudgeVerdict | null;
  model:          string;
  prompt_version: string;
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
