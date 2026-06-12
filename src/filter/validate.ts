import {
  SENIORITY_LEVEL,
  DEGREE_LEVEL,
  EMPLOYMENT_TYPES,
  LOCATION_TYPES,
  COMPENSATION_INTERVALS,
  FX_TO_USD,
} from "./constants.ts"
import type { Profile } from "./types.ts"

/**
 * Validate a profile at load time. A broken profile is a config error,
 * not runtime input — this throws rather than returning a result.
 *
 * Runs once per profile, not per job. Downstream code can assume the
 * profile is structurally valid.
 */
export function validateProfile(profile: Profile): void {
  if (!profile.target_titles?.length) {
    throw new Error("profile.target_titles must be a non-empty array")
  }
  if (!profile.acceptable_seniority?.length) {
    throw new Error("profile.acceptable_seniority must be a non-empty array")
  }
  if (!profile.acceptable_employment?.length) {
    throw new Error("profile.acceptable_employment must be a non-empty array")
  }
  if (!profile.location?.acceptable_types?.length) {
    throw new Error(
      "profile.location.acceptable_types must be a non-empty array"
    )
  }

  for (const s of profile.acceptable_seniority) {
    if (SENIORITY_LEVEL[s] === undefined) {
      throw new Error(`Invalid seniority in profile: ${s}`)
    }
  }
  for (const e of profile.acceptable_employment) {
    if (!EMPLOYMENT_TYPES.includes(e as (typeof EMPLOYMENT_TYPES)[number])) {
      throw new Error(`Invalid employment type in profile: ${e}`)
    }
  }
  for (const t of profile.location.acceptable_types) {
    if (!LOCATION_TYPES.includes(t as (typeof LOCATION_TYPES)[number])) {
      throw new Error(`Invalid location type in profile: ${t}`)
    }
  }

  if (DEGREE_LEVEL[profile.education?.degree] === undefined) {
    throw new Error(`Invalid degree in profile: ${profile.education?.degree}`)
  }

  const minAcc = profile.compensation?.min_acceptable
  if (typeof minAcc !== "number" || isNaN(minAcc) || minAcc < 0) {
    throw new Error("profile.compensation.min_acceptable must be a non-negative number")
  }

  const interval = profile.compensation?.interval
  if (
    !COMPENSATION_INTERVALS.includes(
      interval as (typeof COMPENSATION_INTERVALS)[number]
    )
  ) {
    throw new Error(
      `Invalid compensation.interval in profile: ${interval}`
    )
  }

  const currency = profile.compensation?.currency
  if (!currency || FX_TO_USD[currency.toUpperCase()] === undefined) {
    throw new Error(`Profile currency not in FX map: ${currency}`)
  }

  const contact = profile.contact
  if (!contact) {
    throw new Error("profile.contact is required")
  }
  for (const key of [
    "name",
    "email",
    "phone",
    "linkedin",
    "github",
    "city",
    "state",
  ] as const) {
    const v = contact[key]
    if (typeof v !== "string" || !v.trim()) {
      throw new Error(`profile.contact.${key} must be a non-empty string`)
    }
  }

  if (contact.title !== undefined && typeof contact.title !== "string") {
    throw new Error("profile.contact.title must be a string if present")
  }
  if (contact.work_arrangement_note !== undefined && typeof contact.work_arrangement_note !== "string") {
    throw new Error("profile.contact.work_arrangement_note must be a string if present")
  }

  if (
    typeof profile.years_experience !== "number" ||
    isNaN(profile.years_experience) ||
    profile.years_experience < 0
  ) {
    throw new Error("profile.years_experience must be a non-negative number")
  }

  const workAuth = profile.work_authorization
  if (!workAuth || typeof workAuth !== "object") {
    throw new Error("profile.work_authorization is required")
  }
  for (const key of [
    "visa_type",
    "cover_letter_phrasing_sponsorship_needed",
    "cover_letter_phrasing_no_sponsorship_needed",
  ] as const) {
    if (typeof workAuth[key] !== "string") {
      throw new Error(`profile.work_authorization.${key} must be a string`)
    }
  }
}
