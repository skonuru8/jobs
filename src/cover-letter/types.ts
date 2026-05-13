/**
 * types.ts — input/output types for cover letter generation.
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
  /** Human-readable job location for LaTeX template (city, country). */
  location_line?:   string | null;
  /** Optional requisition id for Re: line suffix. */
  req_id?:          string | null;
}

// ---------------------------------------------------------------------------
// Full generator input
// ---------------------------------------------------------------------------

export interface CandidateContact {
  name: string;
  email: string;
  phone: string;
  linkedin: string;
  github: string;
  city: string;
  state: string;
}

export interface CandidateProfile {
  skills: Array<{ name: string; years: number; confidence: string; category: string }>;
  years_experience: number;
  education: { degree: string; field: string };
  preferred_domains: string[];
  contact: CandidateContact;
  /** Default headline under name in template. */
  title?: string;
  /** LaTeX line for location + work arrangement, e.g. "Jersey City, NJ \\quad (Remote)". */
  location_line?: string;
}

export interface CoverLetterInput {
  job:    CoverLetterJobInput;
  profile: CandidateProfile;
  /** Full canonical resume TeX or stripped text; may be large. */
  resume: string | null;
}

// ---------------------------------------------------------------------------
// Generator output
// ---------------------------------------------------------------------------

export interface CoverLetterResult {
  status:          "ok" | "error";
  /** Prose body only (no greeting/sign-off). */
  text:            string | null;
  model:           string;
  prompt_version:  string;
  prompt_sha:      string;
  generated_at:    string;
  word_count?:     number;
  input_tokens?:   number;
  output_tokens?:  number;
  error?:          string;
}

// ---------------------------------------------------------------------------
// Config (from config.json llm.cover_letter)
// ---------------------------------------------------------------------------

export interface CoverLetterConfig {
  model:       string;
  max_tokens:  number;
  temperature: number;
  throttle_ms: number;
  /** Jobs in REVIEW_QUEUE with score >= this threshold also get a draft. */
  review_queue_threshold?: number;
  retries?: number;
  compile_pdf?: boolean;
  thinking?: {
    type:          "enabled";
    budget_tokens: number;
  };
}
