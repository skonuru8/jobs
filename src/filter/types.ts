export interface JobMeta {
  job_id: string
  schema_version: string
  source_site: string
  source_url: string
  source_score: number | null
  posted_at: string | null
  scraped_at: string
  run_id: string
  flags: string[]
}

export interface Compensation {
  min: number | null
  max: number | null
  currency: string | null
  interval: string | null
}

export interface JobLocation {
  type: string | null
  timezone: string | null
  cities: string[]
  countries: string[]
}

export interface RequiredSkill {
  name: string
  years_required: number | null
  importance: string
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
  | "offered"
  | "denied"
  | "ead_eligible"
  | "payment_model_only"
  | "unmentioned";

export interface Job {
  meta: JobMeta
  title: string
  seniority: string
  employment_type: string | null
  company: { name: string; type: string }
  location: JobLocation
  compensation: Compensation
  required_skills: RequiredSkill[]
  years_experience: { min: number | null; max: number | null }
  education_required: { minimum: string; field: string }
  visa_sponsorship: VisaSponsorshipStatus
  visa_quote: string | null
  security_clearance: string
  domain: string | null
  responsibilities: string[]
  description_raw: string
}

export interface ProfileCompensation {
  min_acceptable: number
  currency: string
  interval: string
}

/** Cover letters and correspondence — structured contact block on profile.json */
export interface ProfileContact {
  name: string
  email: string
  phone: string
  linkedin: string
  github: string
  city: string
  state: string
  /** Display headline (decoupled from target_titles ordering). */
  title?: string
  /** e.g. "Open to Onsite" — matches resume header when set. */
  work_arrangement_note?: string
}

export interface Profile {
  meta: {
    profile_id: string
    schema_version: string
    version: string
    last_updated: string
  }
  target_titles: string[]
  acceptable_seniority: string[]
  acceptable_employment: string[]
  location: {
    current_city: string
    current_country: string
    timezone: string
    acceptable_types: string[]
    acceptable_cities: string[]
    acceptable_countries: string[]
    willing_to_relocate: boolean
  }
  compensation: ProfileCompensation
  contact: ProfileContact
  skills: Array<{
    name: string
    years: number
    confidence: string
    category: string
  }>
  years_experience: number
  education: { degree: string; field: string }
  work_authorization: {
    requires_sponsorship: boolean
    visa_type: string
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
  preferred_domains: string[]
  deal_breakers: string[]
}

export type Verdict = "PASS" | "REJECT"

export interface FilterResult {
  verdict: Verdict
  reason: string | null
  flags: string[]
}
