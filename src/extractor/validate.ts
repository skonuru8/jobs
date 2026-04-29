/**
 * validate.ts — Zod validation for LLM extraction response.
 *
 * Bible: "Zod (or equivalent) validation on response, retry once on validation failure"
 */

import { z } from "zod";

const ImportanceSchema = z.enum(["required", "preferred", "nice_to_have"]);

const SkillCategorySchema = z.enum([
  "language", "framework", "cloud", "tool", "methodology", "other",
]);

const ExtractedSkillSchema = z.object({
  name:           z.string().min(1).transform(s => s.toLowerCase().trim()),
  years_required: z.number().nullable(),
  importance:     ImportanceSchema,
  category:       SkillCategorySchema,
  quote:          z.string(),
});

const ExtractedYOESchema = z.object({
  min:   z.number().nullable(),
  max:   z.number().nullable(),
  quote: z.string().nullable(),
});

const ExtractedEducationSchema = z.object({
  minimum: z.string(),
  field:   z.string(),
  quote:   z.string().nullable(),
});

export const ExtractedFieldsSchema = z.object({
  required_skills:    z.array(ExtractedSkillSchema),
  years_experience:   ExtractedYOESchema,
  education_required: ExtractedEducationSchema,
  responsibilities:   z.array(z.string()),
  visa_sponsorship:   z.boolean().nullable(),
  security_clearance: z.string(),
  domain:             z.string().nullable(),
});

export type ValidatedFields = z.infer<typeof ExtractedFieldsSchema>;

/**
 * Parse and validate raw JSON string from LLM.
 * Returns { ok: true, data } or { ok: false, error }.
 */
export function validateExtraction(
  raw: string,
): { ok: true; data: ValidatedFields } | { ok: false; error: string } {
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

  const result = ExtractedFieldsSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: result.error.message };
  }

  return { ok: true, data: result.data };
}