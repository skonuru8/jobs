/**
 * judge.test.ts — unit tests for the LLM judge stage.
 *
 * Bible: "fixture-first", "independently testable".
 * No LLM calls here — tests validateJudge, buildJudgePrompt, getBucket,
 * and validates all fixtures against the input schema.
 */

import { describe, it, expect } from "vitest";
import * as fs   from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import { validateJudge }                     from "@/judge/validate";
import { buildJudgePrompt, SYSTEM_PROMPT }   from "@/judge/prompt";
import { getBucket }                         from "@/judge/judge";
import type { JudgeInput, JudgeResult }      from "@/judge/types";

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES   = path.join(__dirname, "../../fixtures/judge");

// ---------------------------------------------------------------------------
// Shared fixture inputs
// ---------------------------------------------------------------------------

const BASE_JOB: JudgeInput["job"] = {
  title:             "Senior Java Full Stack Engineer",
  company:           "Citi",
  employment_type:   "full_time",
  seniority:         "senior",
  domain:            "fintech",
  required_skills:   [
    { name: "java",        importance: "required",  years_required: 5 },
    { name: "spring boot", importance: "required",  years_required: 3 },
    { name: "angular",     importance: "preferred", years_required: null },
  ],
  years_experience:  { min: 5, max: 8 },
  education_required: { minimum: "bachelor", field: "Computer Science" },
  visa_sponsorship:  null,
  responsibilities:  ["Design microservices", "Own technical delivery"],
  flags:             ["posted_at_missing"],
};

const BASE_SCORE: JudgeInput["score"] = {
  total: 0.832,
  components: { skills: 0.85, semantic: 0.72, yoe: 1.0, seniority: 1.0, location: 1.0 },
};

// ---------------------------------------------------------------------------
// validateJudge
// ---------------------------------------------------------------------------

describe("validateJudge", () => {
  it("accepts STRONG verdict with empty concerns", () => {
    const raw = JSON.stringify({ verdict: "STRONG", reasoning: "Great fit.", concerns: [] });
    const result = validateJudge(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.verdict).toBe("STRONG");
  });

  it("accepts MAYBE verdict with concerns", () => {
    const raw = JSON.stringify({
      verdict: "MAYBE", reasoning: "Sponsorship unclear.", concerns: ["Sponsorship not mentioned"],
    });
    const result = validateJudge(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.verdict).toBe("MAYBE");
      expect(result.data.concerns).toHaveLength(1);
    }
  });

  it("accepts WEAK verdict", () => {
    const raw = JSON.stringify({
      verdict: "WEAK", reasoning: "No sponsorship.", concerns: ["Explicitly no sponsorship"],
    });
    const result = validateJudge(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.verdict).toBe("WEAK");
  });

  it("rejects invalid verdict value", () => {
    const raw = JSON.stringify({ verdict: "PASS", reasoning: "ok", concerns: [] });
    const result = validateJudge(raw);
    expect(result.ok).toBe(false);
  });

  it("rejects missing reasoning", () => {
    const raw = JSON.stringify({ verdict: "STRONG", concerns: [] });
    const result = validateJudge(raw);
    expect(result.ok).toBe(false);
  });

  it("rejects empty reasoning string", () => {
    const raw = JSON.stringify({ verdict: "STRONG", reasoning: "", concerns: [] });
    const result = validateJudge(raw);
    expect(result.ok).toBe(false);
  });

  it("rejects missing concerns array", () => {
    const raw = JSON.stringify({ verdict: "STRONG", reasoning: "Good fit." });
    const result = validateJudge(raw);
    expect(result.ok).toBe(false);
  });

  it("returns error on malformed JSON", () => {
    const result = validateJudge("not json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/JSON parse failed/);
  });

  it("strips markdown code fences before parsing", () => {
    const inner = JSON.stringify({ verdict: "STRONG", reasoning: "Good.", concerns: [] });
    const result = validateJudge("```json\n" + inner + "\n```");
    expect(result.ok).toBe(true);
  });
});


// ---------------------------------------------------------------------------
// buildJudgePrompt
// ---------------------------------------------------------------------------

describe("buildJudgePrompt", () => {
  const input: JudgeInput = { job: BASE_JOB, score: BASE_SCORE };

  it("includes job title and company", () => {
    const prompt = buildJudgePrompt(input);
    expect(prompt).toContain("Senior Java Full Stack Engineer");
    expect(prompt).toContain("Citi");
  });

  it("includes required skills", () => {
    const prompt = buildJudgePrompt(input);
    expect(prompt).toContain("java");
    expect(prompt).toContain("spring boot");
  });

  it("includes score total", () => {
    const prompt = buildJudgePrompt(input);
    expect(prompt).toContain("0.83");
  });

  it("includes all score components", () => {
    const prompt = buildJudgePrompt(input);
    expect(prompt).toContain("Skills");
    expect(prompt).toContain("Semantic");
    expect(prompt).toContain("YOE");
    expect(prompt).toContain("Seniority");
    expect(prompt).toContain("Location");
  });

  it("shows 'sponsorship offered' when visa_sponsorship = true", () => {
    const with_visa: JudgeInput = { job: { ...BASE_JOB, visa_sponsorship: true }, score: BASE_SCORE };
    expect(buildJudgePrompt(with_visa)).toContain("sponsorship offered");
  });

  it("shows 'NO sponsorship' when visa_sponsorship = false", () => {
    const no_visa: JudgeInput = { job: { ...BASE_JOB, visa_sponsorship: false }, score: BASE_SCORE };
    expect(buildJudgePrompt(no_visa)).toContain("NO sponsorship");
  });

  it("shows 'not mentioned' when visa_sponsorship = null", () => {
    const null_visa: JudgeInput = { job: { ...BASE_JOB, visa_sponsorship: null }, score: BASE_SCORE };
    expect(buildJudgePrompt(null_visa)).toContain("not mentioned");
  });

  it("shows 'none' when flags is empty", () => {
    const no_flags: JudgeInput = { job: { ...BASE_JOB, flags: [] }, score: BASE_SCORE };
    expect(buildJudgePrompt(no_flags)).toContain("Flags:            none");
  });

  it("is non-empty and contains verdict instructions", () => {
    const prompt = buildJudgePrompt(input);
    expect(prompt.length).toBeGreaterThan(200);
    expect(prompt).toContain("STRONG");
    expect(prompt).toContain("MAYBE");
    expect(prompt).toContain("WEAK");
  });
});


// ---------------------------------------------------------------------------
// SYSTEM_PROMPT sanity
// ---------------------------------------------------------------------------

describe("SYSTEM_PROMPT", () => {
  it("is non-empty", () => {
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(100);
  });

  it("defines all three verdict values", () => {
    expect(SYSTEM_PROMPT).toContain("STRONG");
    expect(SYSTEM_PROMPT).toContain("MAYBE");
    expect(SYSTEM_PROMPT).toContain("WEAK");
  });

  it("contains the no-sponsorship hard rule", () => {
    expect(SYSTEM_PROMPT).toContain("visa_sponsorship = false");
  });
});


// ---------------------------------------------------------------------------
// getBucket — routing logic
// ---------------------------------------------------------------------------

describe("getBucket", () => {
  const makeResult = (verdict: "STRONG" | "MAYBE" | "WEAK"): JudgeResult => ({
    status: "ok", fields: { verdict, reasoning: "test", concerns: [] },
    verdict, model: "test", prompt_version: "v1", judged_at: new Date().toISOString(),
  });

  it("STRONG + score >= 0.70 → COVER_LETTER", () => {
    expect(getBucket(makeResult("STRONG"), 0.857)).toBe("COVER_LETTER");
    expect(getBucket(makeResult("STRONG"), 0.70)).toBe("COVER_LETTER");
  });

  it("STRONG + score < 0.70 → RESULTS", () => {
    expect(getBucket(makeResult("STRONG"), 0.635)).toBe("RESULTS");
    expect(getBucket(makeResult("STRONG"), 0.55)).toBe("RESULTS");
  });

  it("MAYBE → REVIEW_QUEUE regardless of score", () => {
    expect(getBucket(makeResult("MAYBE"), 0.90)).toBe("REVIEW_QUEUE");
    expect(getBucket(makeResult("MAYBE"), 0.56)).toBe("REVIEW_QUEUE");
  });

  it("WEAK → ARCHIVE regardless of score", () => {
    expect(getBucket(makeResult("WEAK"), 0.95)).toBe("ARCHIVE");
    expect(getBucket(makeResult("WEAK"), 0.56)).toBe("ARCHIVE");
  });

  it("judge error → ARCHIVE", () => {
    const errResult: JudgeResult = {
      status: "error", fields: null, verdict: null,
      model: "test", prompt_version: "v1", judged_at: new Date().toISOString(),
      error: "Zod failed",
    };
    expect(getBucket(errResult, 0.90)).toBe("ARCHIVE");
  });
});


// ---------------------------------------------------------------------------
// Fixture validation — all 10 cases have valid structure
// ---------------------------------------------------------------------------

describe("fixtures have valid structure", () => {
  const files = fs.readdirSync(FIXTURES).filter(f => f.endsWith(".json"));

  it("has exactly 10 fixture files", () => {
    expect(files.length).toBe(10);
  });

  for (const file of files) {
    it(`${file} has required fields`, () => {
      const raw  = fs.readFileSync(path.join(FIXTURES, file), "utf-8");
      const data = JSON.parse(raw);

      expect(data).toHaveProperty("_note");
      expect(data).toHaveProperty("input");
      expect(data).toHaveProperty("expected_verdict");
      expect(["STRONG", "MAYBE", "WEAK"]).toContain(data.expected_verdict);

      const { job, score } = data.input as JudgeInput;
      expect(typeof job.title).toBe("string");
      expect(typeof job.company).toBe("string");
      expect(Array.isArray(job.required_skills)).toBe(true);
      expect(typeof score.total).toBe("number");
      expect(score.total).toBeGreaterThanOrEqual(0.55);  // all above gate
    });
  }
});
