/**
 * validate.ts — Zod validation for LLM judge response.
 */

import { z } from "zod";

const judgeGap = z.object({
  requirement:   z.string().min(1),
  severity:        z.enum(["minor", "moderate", "major"]),
  reframe_angle:   z.string(),
});

const gapDirective = z.object({
  jd_requirement: z.string().min(1),
  handling: z.enum(["fabricate", "reframe", "acknowledge", "ignore", "forbid"]),
  target_role: z.string().min(1).nullable(),
  frame_as: z.string().min(1).nullable(),
});

const techSwap = z.object({
  from: z.string(),
  to: z.string(),
  confidence: z.number(),
  target_role: z.string().min(1).nullable(),
});

export const JudgeFieldsSchema = z.object({
  verdict:   z.enum(["STRONG", "MAYBE", "WEAK"]),
  reasoning: z.string().min(1),
  concerns:  z.array(z.string()),

  confidence:      z.number().min(0).max(1).nullable(),
  key_matches:     z.array(z.string()),
  gaps:            z.array(judgeGap),
  gap_directives:  z.array(gapDirective),
  why_apply:       z.string().nullable(),
  tailoring_hints: z.object({
    emphasize_roles:      z.array(z.string()),
    emphasize_skills:     z.array(z.string()),
    downplay_skills:      z.array(z.string()),
    domain_reframe_angle: z.string().nullable(),
    tech_swaps:           z.array(techSwap),
    gap_directives:       z.array(gapDirective),
  }),
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
