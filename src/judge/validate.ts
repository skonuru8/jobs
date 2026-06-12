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
 * When allowedLabels is provided, gates bad target_role values: bad fabricate/reframe
 * directives are downgraded to acknowledge; bad swap roles are dropped. All mutations
 * are flagged in concerns[] so the UI can surface them.
 * Returns { ok: true, data } or { ok: false, error }.
 */
export function validateJudge(
  raw: string,
  allowedLabels?: string[],
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

  const data = result.data;
  if (!allowedLabels || allowedLabels.length === 0) {
    return { ok: true, data };
  }

  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  // Build lookup: normalized → canonical casing
  const labelMap = new Map(allowedLabels.map(l => [normalize(l), l]));

  const extraConcerns: string[] = [];

  // Gate gap_directives
  const gatedDirectives = data.gap_directives.map(d => {
    if (d.target_role === null) return d;
    const canonical = labelMap.get(normalize(d.target_role));
    if (canonical) return { ...d, target_role: canonical };
    // Bad role
    extraConcerns.push(`directive_role_unresolved:${d.target_role}`);
    if (d.handling === "fabricate" || d.handling === "reframe") {
      return { ...d, handling: "acknowledge" as const, target_role: null };
    }
    return { ...d, target_role: null };
  });

  // Gate tailoring_hints.tech_swaps
  const gatedSwaps = data.tailoring_hints.tech_swaps.filter(s => {
    if (s.target_role === null) return true;
    const canonical = labelMap.get(normalize(s.target_role));
    if (canonical) return true;
    extraConcerns.push(`swap_role_unresolved:${s.target_role}`);
    return false;
  }).map(s => {
    if (s.target_role === null) return s;
    return { ...s, target_role: labelMap.get(normalize(s.target_role))! };
  });

  // Gate tailoring_hints.gap_directives (mirror)
  const gatedHintDirectives = data.tailoring_hints.gap_directives.map(d => {
    if (d.target_role === null) return d;
    const canonical = labelMap.get(normalize(d.target_role));
    if (canonical) return { ...d, target_role: canonical };
    if (d.handling === "fabricate" || d.handling === "reframe") {
      return { ...d, handling: "acknowledge" as const, target_role: null };
    }
    return { ...d, target_role: null };
  });

  const finalData: ValidatedJudgeFields = {
    ...data,
    concerns: [...data.concerns, ...extraConcerns],
    gap_directives: gatedDirectives,
    tailoring_hints: {
      ...data.tailoring_hints,
      tech_swaps: gatedSwaps,
      gap_directives: gatedHintDirectives,
    },
  };

  return { ok: true, data: finalData };
}
