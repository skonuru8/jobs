/**
 * schema.ts — JSON Schema for OpenRouter response_format strict mode.
 * Mirrors src/judge/validate.ts JudgeFieldsSchema. Keep in sync.
 */
export const JUDGE_JSON_SCHEMA = {
  name: "judge_fields",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "verdict", "reasoning", "concerns",
      "confidence", "key_matches", "gaps",
      "gap_directives", "why_apply", "tailoring_hints",
    ],
    properties: {
      verdict:    { type: "string", enum: ["STRONG", "MAYBE", "WEAK"] },
      reasoning:  { type: "string" },
      concerns:   { type: "array", items: { type: "string" } },
      confidence: { type: ["number", "null"] },
      key_matches:{ type: "array", items: { type: "string" } },
      gaps: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["requirement", "severity", "reframe_angle"],
          properties: {
            requirement:   { type: "string" },
            severity:      { type: "string", enum: ["minor", "moderate", "major"] },
            reframe_angle: { type: "string" },
          },
        },
      },
      gap_directives: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["jd_requirement", "handling", "target_role", "frame_as"],
          properties: {
            jd_requirement: { type: "string" },
            handling: {
              type: "string",
              enum: ["fabricate", "reframe", "acknowledge", "ignore", "forbid"],
            },
            target_role: { type: ["string", "null"] },
            frame_as:    { type: ["string", "null"] },
          },
        },
      },
      why_apply: { type: ["string", "null"] },
      tailoring_hints: {
        type: "object",
        additionalProperties: false,
        required: [
          "emphasize_roles", "emphasize_skills", "downplay_skills",
          "domain_reframe_angle", "tech_swaps", "gap_directives",
        ],
        properties: {
          emphasize_roles:      { type: "array", items: { type: "string" } },
          emphasize_skills:     { type: "array", items: { type: "string" } },
          downplay_skills:      { type: "array", items: { type: "string" } },
          domain_reframe_angle: { type: ["string", "null"] },
          tech_swaps: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["from", "to", "confidence", "target_role"],
              properties: {
                from:        { type: "string" },
                to:          { type: "string" },
                confidence:  { type: "number" },
                target_role: { type: ["string", "null"] },
              },
            },
          },
          gap_directives: {
            type: "array",
            items: { type: "object" },
          },
        },
      },
    },
  },
} as const;
