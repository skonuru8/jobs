/**
 * ats-score.ts — Deterministic ATS keyword-coverage score for a tailored resume.
 *
 * Measures what fraction of the job's REQUIRED skills appear (case-insensitive,
 * substring) in the final resume LaTeX. Pure function — no LLM, no retry.
 */

export interface AtsScoreResult {
  score: number;
  present: string[];
  missing: string[];
}

export function computeAtsScore(
  resumeTex: string,
  requiredSkills: string[],
): AtsScoreResult {
  const haystack = resumeTex.toLowerCase();
  const present: string[] = [];
  const missing: string[] = [];

  for (const skill of requiredSkills) {
    const needle = skill.trim().toLowerCase();
    if (needle.length === 0) continue;
    if (haystack.includes(needle)) present.push(skill);
    else missing.push(skill);
  }

  const total = present.length + missing.length;
  const score = total === 0 ? 1 : present.length / total;
  return { score, present, missing };
}
