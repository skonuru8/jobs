/**
 * validate.ts — Zod validation for LLM judge response.
 */

import { z } from "zod";

export const JudgeFieldsSchema = z.object({
  verdict:   z.enum(["STRONG", "MAYBE", "WEAK"]),
  reasoning: z.string().min(1),
  concerns:  z.array(z.string()),
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
