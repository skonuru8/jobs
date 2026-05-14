/**
 * validate.ts — Zod validation for LLM judge response.
 */

import { z } from "zod";

const judgeGap = z.object({
  requirement:   z.string().min(1),
  severity:        z.enum(["minor", "moderate", "major"]),
  reframe_angle:   z.string(),
});

export const JudgeFieldsSchema = z.object({
  verdict:   z.enum(["STRONG", "MAYBE", "WEAK"]),
  reasoning: z.string().min(1),
  concerns:  z.array(z.string()),

  confidence:      z.number().min(0).max(1).optional(),
  key_matches:     z.array(z.string()).optional(),
  gaps:            z.array(judgeGap).optional(),
  why_apply:       z.string().optional(),
  tailoring_hints: z.object({
    emphasize_roles:      z.array(z.string()).optional(),
    emphasize_skills:     z.array(z.string()).optional(),
    downplay_skills:      z.array(z.string()).optional(),
    domain_reframe_angle: z.string().optional(),
    tech_swaps: z.array(z.object({
      from:       z.string(),
      to:         z.string(),
      confidence: z.number(),
    })).optional(),
  }).optional(),
});

export type ValidatedJudgeFields = z.infer<typeof JudgeFieldsSchema>;

/**
 * Parse and validate raw JSON string from the LLM judge.
 * Returns { ok: true, data } or { ok: false, error }.
 */
export function validateJudge(
  raw: string,
): { ok: true; data: ValidatedJudgeFields } | { ok: false; error: string } {
  // Strip markdown code fences if model ignored JSON mode
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    return { ok: false, error: `JSON parse failed: ${e}` };
  }

  const result = JudgeFieldsSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: result.error.message };
  }

  return { ok: true, data: result.data };
}
