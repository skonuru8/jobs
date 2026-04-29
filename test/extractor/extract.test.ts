import { describe, it, expect } from "vitest";
import { verifyCitations }   from "@/extractor/extract";
import { validateExtraction } from "@/extractor/validate";
import * as fs   from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES  = path.join(__dirname, "../../fixtures/extractor");

// ---------------------------------------------------------------------------
// validateExtraction — Zod schema
// ---------------------------------------------------------------------------

describe("validateExtraction", () => {

  it("accepts valid extraction", () => {
    const raw = JSON.stringify({
      required_skills: [
        { name: "Java", years_required: 5, importance: "required",
          category: "language", quote: "5+ years of Java" }
      ],
      years_experience:   { min: 5, max: null, quote: "5+ years" },
      education_required: { minimum: "bachelor", field: "Computer Science", quote: "Bachelor's degree" },
      responsibilities:   ["Design microservices", "Write tests"],
      visa_sponsorship:   false,
      security_clearance: "none",
      domain:             "fintech",
    });
    const result = validateExtraction(raw);
    expect(result.ok).toBe(true);
  });

  it("lowercases skill names", () => {
    const raw = JSON.stringify({
      required_skills: [
        { name: "JAVA", years_required: null, importance: "required",
          category: "language", quote: "Java required" }
      ],
      years_experience:   { min: null, max: null, quote: null },
      education_required: { minimum: "", field: "", quote: null },
      responsibilities:   [],
      visa_sponsorship:   null,
      security_clearance: "none",
      domain:             null,
    });
    const result = validateExtraction(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.required_skills[0].name).toBe("java");
    }
  });

  it("rejects invalid importance value", () => {
    const raw = JSON.stringify({
      required_skills: [
        { name: "java", years_required: null, importance: "mandatory",
          category: "language", quote: "java required" }
      ],
      years_experience:   { min: null, max: null, quote: null },
      education_required: { minimum: "", field: "", quote: null },
      responsibilities:   [],
      visa_sponsorship:   null,
      security_clearance: "none",
      domain:             null,
    });
    const result = validateExtraction(raw);
    expect(result.ok).toBe(false);
  });

  it("rejects invalid category value", () => {
    const raw = JSON.stringify({
      required_skills: [
        { name: "java", years_required: null, importance: "required",
          category: "database", quote: "java required" }
      ],
      years_experience:   { min: null, max: null, quote: null },
      education_required: { minimum: "", field: "", quote: null },
      responsibilities:   [],
      visa_sponsorship:   null,
      security_clearance: "none",
      domain:             null,
    });
    const result = validateExtraction(raw);
    expect(result.ok).toBe(false);
  });

  it("strips markdown code fences", () => {
    const inner = JSON.stringify({
      required_skills:    [],
      years_experience:   { min: null, max: null, quote: null },
      education_required: { minimum: "", field: "", quote: null },
      responsibilities:   [],
      visa_sponsorship:   null,
      security_clearance: "none",
      domain:             null,
    });
    const raw = "```json\n" + inner + "\n```";
    const result = validateExtraction(raw);
    expect(result.ok).toBe(true);
  });

  it("returns error on malformed JSON", () => {
    const result = validateExtraction("not json at all");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/JSON parse failed/);
    }
  });

  it("accepts null visa_sponsorship", () => {
    const raw = JSON.stringify({
      required_skills:    [],
      years_experience:   { min: null, max: null, quote: null },
      education_required: { minimum: "", field: "", quote: null },
      responsibilities:   [],
      visa_sponsorship:   null,
      security_clearance: "none",
      domain:             null,
    });
    expect(validateExtraction(raw).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// verifyCitations — pure function
// ---------------------------------------------------------------------------

describe("verifyCitations", () => {

  const baseFields = {
    years_experience:   { min: null, max: null, quote: null },
    education_required: { minimum: "", field: "", quote: null },
    responsibilities:   [],
    visa_sponsorship:   null,
    security_clearance: "none",
    domain:             null,
  };

  it("keeps quote when it is a substring of description_raw", () => {
    const fields = {
      ...baseFields,
      required_skills: [{
        name: "java", years_required: 5, importance: "required" as const,
        category: "language" as const,
        quote: "5+ years of Java experience",
      }],
    };
    const raw = "We need 5+ years of Java experience in Spring Boot.";
    const { fields: result, citationFailures } = verifyCitations(fields, raw);
    expect(citationFailures).toBe(0);
    expect(result.required_skills[0].quote).toBe("5+ years of Java experience");
  });

  it("nulls quote when not a substring", () => {
    const fields = {
      ...baseFields,
      required_skills: [{
        name: "java", years_required: null, importance: "required" as const,
        category: "language" as const,
        quote: "This phrase does not appear anywhere",
      }],
    };
    const raw = "Looking for a Java developer with Spring Boot experience.";
    const { fields: result, citationFailures } = verifyCitations(fields, raw);
    expect(citationFailures).toBe(1);
    expect(result.required_skills[0].quote).toBe("");
  });

  it("is case-insensitive for quote matching", () => {
    const fields = {
      ...baseFields,
      required_skills: [{
        name: "java", years_required: null, importance: "required" as const,
        category: "language" as const,
        quote: "JAVA AND SPRING BOOT",
      }],
    };
    const raw = "Java and Spring Boot required for this role.";
    const { citationFailures } = verifyCitations(fields, raw);
    expect(citationFailures).toBe(0);
  });

  it("counts multiple failures", () => {
    const fields = {
      ...baseFields,
      required_skills: [
        { name: "java",   years_required: null, importance: "required" as const,
          category: "language" as const, quote: "fake quote one" },
        { name: "python", years_required: null, importance: "required" as const,
          category: "language" as const, quote: "fake quote two" },
      ],
    };
    const raw = "Looking for experienced engineers.";
    const { citationFailures } = verifyCitations(fields, raw);
    expect(citationFailures).toBe(2);
  });

  it("verifies YOE quote", () => {
    const fields = {
      ...baseFields,
      required_skills: [],
      years_experience: { min: 5, max: null, quote: "5+ years of experience" },
    };
    const raw = "We require 5+ years of experience in backend development.";
    const { fields: result, citationFailures } = verifyCitations(fields, raw);
    expect(citationFailures).toBe(0);
    expect(result.years_experience.quote).toBe("5+ years of experience");
  });

  it("nulls YOE quote when not found", () => {
    const fields = {
      ...baseFields,
      required_skills: [],
      years_experience: { min: 5, max: null, quote: "invented quote here" },
    };
    const raw = "Seeking experienced engineers.";
    const { fields: result, citationFailures } = verifyCitations(fields, raw);
    expect(citationFailures).toBe(1);
    expect(result.years_experience.quote).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fixture validation — expected JSONs are valid schema
// ---------------------------------------------------------------------------

describe("fixtures are valid schema", () => {
  const expectedFiles = fs
    .readdirSync(FIXTURES)
    .filter(f => f.endsWith("-expected.json"));

  for (const file of expectedFiles) {
    it(`${file} passes Zod schema`, () => {
      const raw = fs.readFileSync(path.join(FIXTURES, file), "utf-8");
      // Strip _note field (not part of schema)
      const obj = JSON.parse(raw);
      delete obj._note;
      const result = validateExtraction(JSON.stringify(obj));
      expect(result.ok).toBe(true);
    });
  }
});