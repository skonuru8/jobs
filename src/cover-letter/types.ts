/**
 * types.ts — input/output types for cover letter generation.
 * Bible §12 Milestone 6.
 */

// ---------------------------------------------------------------------------
// Job context passed to the generator
// ---------------------------------------------------------------------------

export interface CoverLetterJobInput {
  job_id:           string;
  title:            string;
  company:          string;
  domain:           string | null;
  employment_type:  string | null;
  required_skills:  Array<{ name: string; importance: string; years_required: number | null }>;
  responsibilities: string[];
  yoe_min:          number | null;
  yoe_max:          number | null;
  visa_sponsorship: boolean | null;
  score:            number;
  score_components: {
    skills:    number;
    semantic:  number;
    yoe:       number;
    seniority: number;
    location:  number;
  };
  judge_reasoning:  string | null;
  judge_concerns:   string[];
}

// ---------------------------------------------------------------------------
// Full generator input
// ---------------------------------------------------------------------------

export interface CoverLetterInput {
  job:    CoverLetterJobInput;
  profile: {
    skills: Array<{ name: string; years: number; confidence: string; category: string }>;
    years_experience: number;
    education: { degree: string; field: string };
    preferred_domains: string[];
  };
  resume: string | null;   // raw text from config/resume.md — null if file missing/empty
}

// ---------------------------------------------------------------------------
// Generator output
// ---------------------------------------------------------------------------

export interface CoverLetterResult {
  status:         "ok" | "error";
  text:           string | null;   // plain text body (no greeting, no sign-off)
  model:          string;
  prompt_version: string;
  generated_at:   string;
  word_count?:    number;
  error?:         string;
}

// ---------------------------------------------------------------------------
// Config (from config.json llm.cover_letter)
// ---------------------------------------------------------------------------

export interface CoverLetterConfig {
  model:       string;
  max_tokens:  number;
  temperature: number;
  throttle_ms: number;
  /** Jobs in REVIEW_QUEUE with score >= this threshold also get a draft.
   *  Bucket stays REVIEW_QUEUE — human still reviews judge concerns first.
   *  Set to 1.0 to disable (only COVER_LETTER bucket gets letters). */
  review_queue_threshold?: number;
  thinking?: {
    type:          "enabled";
    budget_tokens: number;
  };
}
