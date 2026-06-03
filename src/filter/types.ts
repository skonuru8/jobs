/**
 * types.ts — Filter-stage contracts for normalized jobs, profiles, and verdicts.
 *
 * Defines shared shapes that hard filters, judges, and downstream routing use to
 * classify scraped jobs before scoring and artifact generation. Keeps policy data
 * explicit so filter decisions stay auditable across pipeline runs.
 *
 * Called by: filter implementation, judge stage, pipeline orchestration
 * Writes to: nothing
 * Side effects: none
 */
export interface JobMeta {
  /** Stable job identifier used across artifacts, persistence, and routing. */
  job_id: string
  /** Schema version of normalized job payload. */
  schema_version: string
  /** Scraper source name such as `jobright`. */
  source_site: string
  /** Canonical source URL for traceability and dedupe. */
  source_url: string
  /** Optional upstream source-confidence score, or `null` when unavailable. */
  source_score: number | null
  /** Original posting timestamp, or `null` when source did not expose it. */
  posted_at: string | null
  /** Timestamp when current pipeline run scraped this job. */
  scraped_at: string
  /** Run identifier that produced this normalized payload. */
  run_id: string
  /** Non-fatal extraction or routing flags already attached to job. */
  flags: string[]
}

export interface Compensation {
  /** Minimum compensation bound, or `null` when missing. */
  min: number | null
  /** Maximum compensation bound, or `null` when missing. */
  max: number | null
  /** Currency code associated with compensation numbers, or `null` when unknown. */
  currency: string | null
  /** Compensation cadence such as hourly, monthly, or annual. */
  interval: string | null
}

export interface JobLocation {
  /** Work arrangement type such as remote, hybrid, onsite, or `null` when unclear. */
  type: string | null
  /** Timezone hint extracted from JD, or `null` when absent. */
  timezone: string | null
  /** Normalized city list extracted from job text. */
  cities: string[]
  /** Normalized country list extracted from job text. */
  countries: string[]
}

export interface RequiredSkill {
  /** Normalized skill name after extraction cleanup. */
  name: string
  /** Minimum years requested for this skill, or `null` when unspecified. */
  years_required: number | null
  /** Importance tier as emitted by extractor. */
  importance: string
  /** Broad skill bucket used by scoring and audits. */
  category: string
}

/**
 * Visa sponsorship status extracted from the job description:
 * - `offered`            — JD explicitly states sponsorship is available
 * - `denied`             — JD explicitly states no sponsorship (e.g. "must be authorized")
 * - `ead_eligible`       — EAD / OPT / STEM OPT mentioned as acceptable
 * - `payment_model_only` — C2C / 1099 contract that doesn't require employer sponsorship
 * - `unmentioned`        — no sponsorship language found; status unknown
 */
export type VisaSponsorshipStatus =
  /** JD explicitly says employer sponsorship is available. */
  | "offered"
  /** JD explicitly rules out sponsorship or requires existing authorization. */
  | "denied"
  /** JD allows EAD / OPT / STEM OPT without broad sponsorship language. */
  | "ead_eligible"
  /** Contracting model avoids employer sponsorship question entirely. */
  | "payment_model_only"
  /** JD never addresses sponsorship, so filter must treat it as unknown. */
  | "unmentioned";

export interface Job {
  /** Source and run metadata used for routing and persistence. */
  meta: JobMeta
  /** Human-facing job title after normalization. */
  title: string
  /** Extracted seniority label used by filtering and scoring. */
  seniority: string
  /** Employment model such as full-time or contract, or `null` when absent. */
  employment_type: string | null
  /** Hiring company identity and broad company type. */
  company: {
    /** Employer display name. */
    name: string
    /** Coarse company type for heuristics and reporting. */
    type: string
  }
  /** Parsed job location constraints. */
  location: JobLocation
  /** Parsed compensation range and units. */
  compensation: Compensation
  /** Extracted normalized skill requirements. */
  required_skills: RequiredSkill[]
  /** Parsed experience range in years. */
  years_experience: {
    /** Minimum years required, or `null` when absent. */
    min: number | null
    /** Maximum years mentioned, or `null` when absent. */
    max: number | null
  }
  /** Minimum education requirement extracted from JD. */
  education_required: {
    /** Lowest acceptable degree level described by job. */
    minimum: string
    /** Field of study requirement, if extractor could identify one. */
    field: string
  }
  /** Sponsorship classification derived from JD wording. */
  visa_sponsorship: VisaSponsorshipStatus
  /** Verbatim sponsorship evidence snippet, or `null` when none captured. */
  visa_quote: string | null
  /** Clearance requirement string used by hard filters and review queue logic. */
  security_clearance: string
  /** Coarse domain classification such as healthcare or fintech, or `null` when absent. */
  domain: string | null
  /** Extracted responsibility bullets for downstream prompts and artifacts. */
  responsibilities: string[]
  /** Full raw job description used when downstream stages need original wording. */
  description_raw: string
}

export interface ProfileCompensation {
  /** Minimum acceptable compensation floor in stated currency and interval. */
  min_acceptable: number
  /** Currency code for `min_acceptable`. */
  currency: string
  /** Compensation interval such as hourly, monthly, or annual. */
  interval: string
}

/** Cover letters and correspondence — structured contact block on profile.json */
export interface ProfileContact {
  /** Candidate full name for resume and cover-letter headers. */
  name: string
  /** Primary email used in generated artifacts. */
  email: string
  /** Phone number formatted for display. */
  phone: string
  /** LinkedIn profile URL or handle. */
  linkedin: string
  /** GitHub profile URL or handle. */
  github: string
  /** Home city displayed in contact block. */
  city: string
  /** Home state or region displayed in contact block. */
  state: string
  /** Display headline (decoupled from target_titles ordering). */
  title?: string
  /** e.g. "Open to Onsite" — matches resume header when set. */
  work_arrangement_note?: string
}

export interface Profile {
  meta: {
    /** Stable profile identifier for persistence and audit trails. */
    profile_id: string
    /** Schema version of `profile.json`. */
    schema_version: string
    /** User-managed profile content version. */
    version: string
    /** Last timestamp when profile data was edited. */
    last_updated: string
  }
  /** Preferred target titles in descending relevance order. */
  target_titles: string[]
  /** Acceptable seniority bands for hard filtering. */
  acceptable_seniority: string[]
  /** Acceptable employment models for hard filtering. */
  acceptable_employment: string[]
  location: {
    /** Candidate home city used for relocation and locality comparisons. */
    current_city: string
    /** Candidate home country used for locality comparisons. */
    current_country: string
    /** Candidate local timezone for scheduling and matching heuristics. */
    timezone: string
    /** Allowed work arrangements such as remote, hybrid, or onsite. */
    acceptable_types: string[]
    /** Explicitly accepted cities for non-remote roles. */
    acceptable_cities: string[]
    /** Explicitly accepted countries for non-remote roles. */
    acceptable_countries: string[]
    /** Whether jobs outside listed cities/countries can still be considered. */
    willing_to_relocate: boolean
  }
  /** Compensation floor candidate is willing to accept. */
  compensation: ProfileCompensation
  /** Contact block and header content for generated artifacts. */
  contact: ProfileContact
  skills: Array<{
    /** Normalized skill name from profile. */
    name: string
    /** Self-reported years of experience with this skill. */
    years: number
    /** Confidence band for claimed skill strength. */
    confidence: string
    /** Broad skill bucket such as language, framework, or cloud. */
    category: string
  }>
  /** Total professional years used by deterministic scoring. */
  years_experience: number
  education: {
    /** Highest relevant degree candidate lists. */
    degree: string
    /** Field of study associated with highest relevant degree. */
    field: string
  }
  work_authorization: {
    /** Whether candidate currently needs employer sponsorship. */
    requires_sponsorship: boolean
    /** Visa or work authorization label for downstream phrasing logic. */
    visa_type: string
    /** Whether candidate can pursue clearance-required roles if needed. */
    clearance_eligible: boolean
    /**
     * Verbatim sentence to insert in the cover letter when sponsorship
     * is needed and the job has not denied sponsorship. User-authored.
     * Generator inserts as-is, no rewording, no paraphrasing.
     */
    cover_letter_phrasing_sponsorship_needed: string
    /**
     * Verbatim sentence when sponsorship is not needed (citizen / GC).
     * Generator inserts as-is.
     */
    cover_letter_phrasing_no_sponsorship_needed: string
  }
  /** Preferred industry or business domains used as soft signal only. */
  preferred_domains: string[]
  /** Hard no-go conditions filter should reject immediately when matched. */
  deal_breakers: string[]
}

/**
 * Filter outcome before downstream routing.
 * - `PASS`   — job survives hard filter and can continue through pipeline
 * - `REJECT` — job fails hard filter and should be archived with reason
 */
export type Verdict =
  /** Job remains eligible for later stages. */
  | "PASS"
  /** Job stops here and is routed out of main pipeline. */
  | "REJECT"

export interface FilterResult {
  /** Final pass/reject decision from hard filter stage. */
  verdict: Verdict
  /** Primary rejection explanation, or `null` when verdict is `PASS`. */
  reason: string | null
  /** Flags emitted during filtering for routing, audit, or judge follow-up. */
  flags: string[]
}
