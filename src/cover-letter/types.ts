/**
 * types.ts — cover letter generation contracts.
 *
 * Defines job context, candidate profile, generator result, and config shapes
 * used to build tailored cover letter prompts and persist the resulting draft.
 *
 * Called by: cover-letter generator/prompt/saver modules, artifact bundle helpers
 * Side effects: none; type-only module
 */

import type { VisaSponsorshipStatus } from "@/filter/types";
import type { GapDirective, TechSwap } from "@/judge/types";

// ---------------------------------------------------------------------------
// Job context passed to the generator
// ---------------------------------------------------------------------------

export interface CoverLetterJobInput {
  /** Stable pipeline job identifier used in artifact metadata and output folders. */
  job_id:           string;
  /** Normalized job title shown in prompts and LaTeX template fields. */
  title:            string;
  /** Employer display name used in salutation and subject line fields. */
  company:          string;
  /** Optional company or role domain label used to steer tailoring tone. */
  domain:           string | null;
  /** Optional employment classification such as full-time, contract, or internship. */
  employment_type:  string | null;
  /** Required skills extracted from the job description, ordered by importance. */
  required_skills:  Array<{ name: string; importance: string; years_required: number | null }>;
  /** Responsibility bullets copied from the job description for prompt grounding. */
  responsibilities: string[];
  /** Minimum years-of-experience expectation when the posting states one explicitly. */
  yoe_min:          number | null;
  /** Maximum years-of-experience expectation when the posting states a bounded range. */
  yoe_max:          number | null;
  /** Sponsorship interpretation derived from job filtering and quote extraction. */
  visa_sponsorship: VisaSponsorshipStatus;
  /** Raw sponsorship quote preserved for prompt context when JD language matters. */
  visa_quote:       string | null;
  /** Aggregate resume-to-job match score in the 0-1 range. */
  score:            number;
  /** Score breakdown used to explain strengths and weaknesses in prompt context. */
  score_components: {
    /** Skill overlap subscore from extracted required skills. */
    skills:    number;
    /** Semantic similarity subscore between resume and job text. */
    semantic:  number;
    /** Years-of-experience fit subscore against job expectations. */
    yoe:       number;
    /** Seniority alignment subscore for title and level matching. */
    seniority: number;
    /** Location/work authorization fit subscore. */
    location:  number;
  };
  /** Optional judge explanation used to reinforce strongest fit claims. */
  judge_reasoning:  string | null;
  /** Judge-raised concerns that the cover letter may need to proactively address. */
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
  /** Candidate full name rendered in header and signature. */
  name: string;
  /** Primary email address rendered in contact block. */
  email: string;
  /** Preferred phone number rendered in contact block. */
  phone: string;
  /** Public LinkedIn URL or handle rendered in contact block. */
  linkedin: string;
  /** Public GitHub URL or handle rendered in contact block. */
  github: string;
  /** Candidate home city used in template location line fallbacks. */
  city: string;
  /** Candidate home state or region used in template location line fallbacks. */
  state: string;
}

export interface CandidateProfile {
  /** Structured skill inventory available for prompt-level evidence selection. */
  skills: Array<{ name: string; years: number; confidence: string; category: string }>;
  /** Total professional experience used to calibrate seniority claims. */
  years_experience: number;
  /** Highest-value education entry to reference when relevant to the role. */
  education: { degree: string; field: string };
  /** Preferred industry domains used to align motivation language. */
  preferred_domains: string[];
  /** Work authorization facts and phrasing snippets used for sponsorship wording. */
  work_authorization: {
    /** Whether the candidate currently needs employer sponsorship to work. */
    requires_sponsorship: boolean;
    /** Current visa type, if one exists and should influence phrasing. */
    visa_type: string;
    /** Whether the candidate can pursue clearance-sensitive roles. */
    clearance_eligible: boolean;
    /** Template phrase to use when sponsorship disclosure is required. */
    cover_letter_phrasing_sponsorship_needed: string;
    /** Template phrase to use when sponsorship disclosure is not required. */
    cover_letter_phrasing_no_sponsorship_needed: string;
  };
  /** Candidate contact information rendered into the LaTeX header block. */
  contact: CandidateContact;
  /** Default headline under name in template. */
  title?: string;
  /** LaTeX line for location + work arrangement, e.g. "Jersey City, NJ \\quad (Remote)". */
  location_line?: string;
}

export interface CoverLetterInput {
  /** Job context and scoring data that determine tailoring direction. */
  job:    CoverLetterJobInput;
  /** Candidate profile facts allowed in the generated cover letter. */
  profile: CandidateProfile;
  /** Legacy: full resume TeX/text; omit when experience_block is set. */
  resume: string | null;
  /** Verbatim EXPERIENCE slice from canonical resume (preferred over full resume). */
  experience_block?: string | null;
  /** Optional judge-supplied gap directives to address weak spots carefully. */
  gap_directives?: GapDirective[];
  /** Optional technology substitutions approved by the judge layer. */
  tech_swaps?: TechSwap[];
}

// ---------------------------------------------------------------------------
// Generator output
// ---------------------------------------------------------------------------

export interface CoverLetterResult {
  /**
   * Generator outcome.
   * - `ok` — text payload is present and safe to template into LaTeX
   * - `error` — generation failed; inspect `error` and artifact flags
   */
  status:          "ok" | "error";
  /** Prose body only (no greeting/sign-off). */
  text:            string | null;
  /** Model identifier used for generation. */
  model:           string;
  /** Human-readable prompt version label for auditability. */
  prompt_version:  string;
  /** Stable hash of prompt instructions used for cache and provenance. */
  prompt_sha:      string;
  /** ISO timestamp for when the draft was generated. */
  generated_at:    string;
  /** Approximate body word count, if returned by generator or computed downstream. */
  word_count?:     number;
  /** Input token usage reported by provider when available. */
  input_tokens?:   number;
  /** Output token usage reported by provider when available. */
  output_tokens?:  number;
  /** Provider or orchestration error message when status is `error`. */
  error?:          string;
}

// ---------------------------------------------------------------------------
// Config (from config.json llm.cover_letter)
// ---------------------------------------------------------------------------

export interface CoverLetterConfig {
  /** Model identifier used for cover letter generation requests. */
  model:       string;
  /** Maximum generation token budget passed to provider. */
  max_tokens:  number;
  /** Sampling temperature used to balance variation against determinism. */
  temperature: number;
  /** Minimum delay between requests to avoid bursty provider usage. */
  throttle_ms: number;
  /** Jobs in REVIEW_QUEUE with score >= this threshold also get a draft. */
  review_queue_threshold?: number;
  /** Retry count for transient provider failures. */
  retries?: number;
  /** Whether to compile PDF output after writing the LaTeX source. Defaults to true. */
  compile_pdf?: boolean;
  /** Optional reasoning-budget controls for providers that support explicit thinking. */
  thinking?: {
    /**
     * Thinking mode selector.
     * - `enabled` — request provider-side reasoning budget for better drafting
     */
    type:          "enabled";
    /** Token budget reserved for provider-side reasoning steps. */
    budget_tokens: number;
  };
}
