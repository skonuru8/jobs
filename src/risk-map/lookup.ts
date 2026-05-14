import { getRiskMapCache } from "./loader";
import type { RiskEntry } from "./types";

/**
 * Best RiskEntry for a JD-side skill. Lowest truth_distance, then highest confidence.
 * Returns null if not in the map at all.
 */
export function lookupJdSkill(skill: string): RiskEntry | null {
  const entries = getRiskMapCache().jdIndex[skill.toLowerCase().trim()];
  if (!entries?.length) return null;
  return [...entries].sort((a, b) =>
    a.truth_distance_score - b.truth_distance_score || b.confidence - a.confidence,
  )[0];
}

/**
 * All entries for a JD-side skill (for cases where multiple candidate sources exist).
 */
export function lookupJdSkillAll(skill: string): RiskEntry[] {
  return getRiskMapCache().jdIndex[skill.toLowerCase().trim()] ?? [];
}

/**
 * Audit-side: every entry indexed by a resume source skill.
 */
export function lookupResumeSkill(skill: string): RiskEntry[] {
  return getRiskMapCache().sourceIndex[skill.toLowerCase().trim()] ?? [];
}

/**
 * Returns all target skills currently in the JD index. Used by audit to iterate.
 */
export function getAllJdTargetKeys(): string[] {
  return Object.keys(getRiskMapCache().jdIndex);
}
