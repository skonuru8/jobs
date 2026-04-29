/**
 * schema.ts — JSON Schema for OpenRouter response_format strict mode.
 *
 * Mirror of validate.ts's ExtractedFieldsSchema. Keep them in sync.
 * Strict mode requires `additionalProperties: false` on every object,
 * and `required` listing every property on every object.
 */

export const EXTRACTION_JSON_SCHEMA = {
  name: "extracted_fields",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "required_skills",
      "years_experience",
      "education_required",
      "responsibilities",
      "visa_sponsorship",
      "security_clearance",
      "domain",
    ],
    properties: {
      required_skills: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "years_required", "importance", "category", "quote"],
          properties: {
            name:           { type: "string" },
            years_required: { type: ["number", "null"] },
            importance:     { type: "string", enum: ["required", "preferred", "nice_to_have"] },
            category:       { type: "string", enum: ["language", "framework", "cloud", "tool", "methodology", "other"] },
            quote:          { type: "string" },
          },
        },
      },
      years_experience: {
        type: "object",
        additionalProperties: false,
        required: ["min", "max", "quote"],
        properties: {
          min:   { type: ["number", "null"] },
          max:   { type: ["number", "null"] },
          quote: { type: ["string", "null"] },
        },
      },
      education_required: {
        type: "object",
        additionalProperties: false,
        required: ["minimum", "field", "quote"],
        properties: {
          minimum: { type: "string" },
          field:   { type: "string" },
          quote:   { type: ["string", "null"] },
        },
      },
      responsibilities: {
        type: "array",
        items: { type: "string" },
      },
      visa_sponsorship:   { type: ["boolean", "null"] },
      security_clearance: { type: "string" },
      domain:             { type: ["string", "null"] },
    },
  },
} as const;
