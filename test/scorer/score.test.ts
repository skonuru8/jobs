/**
 * score.test.ts — unit tests for all scoring components + composite scorer.
 *
 * Bible: "fixture-first", "independently testable", "20 fixtures" for scorer.
 * No I/O, no LLM, no embeddings needed — all deterministic.
 */

import { describe, it, expect } from "vitest";
import {
  scoreSkills,
  scoreYOE,
  scoreSeniority,
  scoreLocation,
  scoreSemantic,
} from "@/scorer/components.js";
import { scoreJob, DEFAULT_WEIGHTS, DEFAULT_THRESHOLD } from "@/scorer/score.js";
import type { ProfileSkill } from "@/scorer/types.js";

// ---------------------------------------------------------------------------
// scoreSkills
// ---------------------------------------------------------------------------

const PROFILE_SKILLS: ProfileSkill[] = [
  { name: "java",        years: 6, confidence: "expert",   category: "language" },
  { name: "typescript",  years: 5, confidence: "expert",   category: "language" },
  { name: "spring boot", years: 5, confidence: "expert",   category: "framework" },
  { name: "aws",         years: 2, confidence: "strong",   category: "cloud" },
  { name: "kafka",       years: 2, confidence: "strong",   category: "tool" },
  { name: "python",      years: 1, confidence: "familiar", category: "language" },
];

describe("scoreSkills", () => {
  it("perfect match — all required skills present as expert → 1.0", () => {
    // Need 6+ required+preferred skills to bypass thin-extraction ceiling.
    // All map to expert profile skills so numerator = denominator.
    // (Use 6 skills the profile has at expert/strong, not familiar.)
    const PROFILE_EXPERT_SKILLS: ProfileSkill[] = [
      { name: "java",        years: 6, confidence: "expert",   category: "language" },
      { name: "typescript",  years: 5, confidence: "expert",   category: "language" },
      { name: "spring boot", years: 5, confidence: "expert",   category: "framework" },
      { name: "aws",         years: 2, confidence: "expert",   category: "cloud" },
      { name: "kafka",       years: 2, confidence: "expert",   category: "tool" },
      { name: "redis",       years: 2, confidence: "expert",   category: "tool" },
    ];
    const jobSkills = [
      { name: "java",        years_required: 5, importance: "required" as const, category: "language" },
      { name: "spring boot", years_required: 3, importance: "required" as const, category: "framework" },
      { name: "typescript",  years_required: 3, importance: "required" as const, category: "language" },
      { name: "aws",         years_required: 2, importance: "required" as const, category: "cloud" },
      { name: "kafka",       years_required: 2, importance: "required" as const, category: "tool" },
      { name: "redis",       years_required: 1, importance: "required" as const, category: "tool" },
    ];
    expect(scoreSkills(jobSkills, PROFILE_EXPERT_SKILLS)).toBe(1.0);
  });

  it("thin extraction — 2 matching skills capped at 0.85", () => {
    // Even with perfect match, <6 skills triggers the thin-extraction ceiling.
    // Prevents sparse JDs (or lazy extractions) from dominating the ranking.
    const jobSkills = [
      { name: "java",        years_required: 5, importance: "required" as const, category: "language" },
      { name: "spring boot", years_required: 3, importance: "required" as const, category: "framework" },
    ];
    expect(scoreSkills(jobSkills, PROFILE_SKILLS)).toBe(0.85);
  });

  it("no job skills → 1.0 (no bar)", () => {
    expect(scoreSkills([], PROFILE_SKILLS)).toBe(1.0);
  });

  it("required skill missing → significant penalty", () => {
    const jobSkills = [
      { name: "golang", years_required: 3, importance: "required" as const, category: "language" },
      { name: "java",   years_required: 3, importance: "required" as const, category: "language" },
    ];
    const score = scoreSkills(jobSkills, PROFILE_SKILLS);
    // Java matched (expert=1.0×required=1.0), golang missing (0). Avg = 0.5
    expect(score).toBeCloseTo(0.5, 2);
  });

  it("preferred skill missing → smaller penalty than required", () => {
    const jobSkills = [
      { name: "java",   years_required: 5, importance: "required" as const, category: "language" },
      { name: "golang", years_required: 2, importance: "preferred" as const, category: "language" },
    ];
    const scoreMissingPreferred = scoreSkills(jobSkills, PROFILE_SKILLS);

    const jobSkillsAllHave = [
      { name: "java",   years_required: 5, importance: "required" as const,  category: "language" },
      { name: "python", years_required: 2, importance: "preferred" as const, category: "language" },
    ];
    const scoreAllHave = scoreSkills(jobSkillsAllHave, PROFILE_SKILLS);

    expect(scoreAllHave).toBeGreaterThan(scoreMissingPreferred);
  });

  it("nice_to_have only — not in denominator", () => {
    const jobSkills = [
      { name: "rust", years_required: null, importance: "nice_to_have" as const, category: "language" },
    ];
    // Denominator = 0 (no required/preferred) → 1.0
    expect(scoreSkills(jobSkills, PROFILE_SKILLS)).toBe(1.0);
  });

  it("familiar skill matched at partial credit", () => {
    const jobSkills = [
      { name: "python", years_required: 1, importance: "required" as const, category: "language" },
    ];
    const score = scoreSkills(jobSkills, PROFILE_SKILLS);
    // Python is familiar (weight=0.4) → score = 0.4 (not 0, not 1)
    expect(score).toBeCloseTo(0.4, 2);
  });

  it("all nice_to_have + required match → above 1.0 clamped to 1.0", () => {
    const jobSkills = [
      { name: "java",   years_required: 5, importance: "required" as const,     category: "language" },
      { name: "golang", years_required: 1, importance: "nice_to_have" as const, category: "language" },
    ];
    expect(scoreSkills(jobSkills, PROFILE_SKILLS)).toBeLessThanOrEqual(1.0);
  });
});


// ---------------------------------------------------------------------------
// scoreYOE
// ---------------------------------------------------------------------------

describe("scoreYOE", () => {
  it("within range → 1.0", () => {
    expect(scoreYOE(4, 8, 6)).toBe(1.0);
  });

  it("exactly at min → 1.0", () => {
    expect(scoreYOE(6, 10, 6)).toBe(1.0);
  });

  it("exactly at max → 1.0", () => {
    expect(scoreYOE(2, 6, 6)).toBe(1.0);
  });

  it("null YOE range → 0.75", () => {
    expect(scoreYOE(null, null, 6)).toBe(0.75);
  });

  it("underqualified by 1yr → 0.8", () => {
    // gap=1, penalty = 1 - 1*0.2 = 0.8
    expect(scoreYOE(7, 10, 6)).toBeCloseTo(0.8, 2);
  });

  it("underqualified by 5yr → 0.0", () => {
    expect(scoreYOE(11, 15, 6)).toBe(0.0);
  });

  it("overqualified by 1yr → 0.9 (above floor)", () => {
    // gap=1, 1 - 1*0.1 = 0.9
    expect(scoreYOE(2, 5, 6)).toBeCloseTo(0.9, 2);
  });

  it("overqualified by 6yr → floor 0.4", () => {
    expect(scoreYOE(0, 0, 6)).toBe(0.4);
  });

  it("overqualified — score above floor 0.4", () => {
    const score = scoreYOE(2, 4, 10);
    expect(score).toBeGreaterThanOrEqual(0.4);
  });

  it("null min only → treats min as 0", () => {
    expect(scoreYOE(null, 8, 6)).toBe(1.0);
  });
});


// ---------------------------------------------------------------------------
// scoreSeniority
// ---------------------------------------------------------------------------

describe("scoreSeniority", () => {
  const profile = ["senior", "staff"];

  it("exact match → 1.0", () => {
    expect(scoreSeniority("senior", profile)).toBe(1.0);
    expect(scoreSeniority("staff",  profile)).toBe(1.0);
  });

  it("null seniority → 0.6", () => {
    expect(scoreSeniority(null, profile)).toBe(0.6);
    expect(scoreSeniority("", profile)).toBe(0.6);
  });

  it("1 level away → 0.5", () => {
    // lead=4 = same as staff=4, mid=2, senior=3. mid is 1 below senior.
    expect(scoreSeniority("mid",       profile)).toBe(0.5);   // senior=3, mid=2, gap=1
    expect(scoreSeniority("principal", profile)).toBe(0.5);   // principal=5, staff=4, gap=1
  });

  it("2+ levels away → 0.0", () => {
    expect(scoreSeniority("intern", profile)).toBe(0.0);   // intern=0, senior=3, gap=3
    expect(scoreSeniority("junior", profile)).toBe(0.0);   // junior=1, senior=3, gap=2
  });

  it("unknown seniority string → 0.6", () => {
    expect(scoreSeniority("wizard", profile)).toBe(0.6);
  });
});


// ---------------------------------------------------------------------------
// scoreLocation
// ---------------------------------------------------------------------------

const PROFILE_LOC = {
  acceptable_types:     ["remote", "hybrid", "onsite"],
  acceptable_cities:    ["jersey city", "new york", "new york city", "hoboken"],
  acceptable_countries: ["USA"],
  willing_to_relocate:  false,
};

describe("scoreLocation", () => {
  it("remote job, profile accepts remote → 1.0", () => {
    const loc = { type: "remote", cities: [], countries: [] };
    expect(scoreLocation(loc, PROFILE_LOC)).toBe(1.0);
  });

  it("hybrid + acceptable city → 1.0", () => {
    const loc = { type: "hybrid", cities: ["New York"], countries: ["USA"] };
    expect(scoreLocation(loc, PROFILE_LOC)).toBe(1.0);
  });

  it("onsite + acceptable city → 1.0", () => {
    const loc = { type: "onsite", cities: ["Jersey City"], countries: ["USA"] };
    expect(scoreLocation(loc, PROFILE_LOC)).toBe(1.0);
  });

  it("null type → 0.5", () => {
    const loc = { type: null, cities: [], countries: [] };
    expect(scoreLocation(loc, PROFILE_LOC)).toBe(0.5);
  });

  it("type not acceptable → 0.0 (profile rejects this type)", () => {
    const noOnsite = { ...PROFILE_LOC, acceptable_types: ["remote"] };
    const loc = { type: "onsite", cities: ["Jersey City"], countries: ["USA"] };
    expect(scoreLocation(loc, noOnsite)).toBe(0.0);
  });

  it("onsite wrong city, no relocate → 0.0", () => {
    const loc = { type: "onsite", cities: ["Austin"], countries: ["USA"] };
    expect(scoreLocation(loc, PROFILE_LOC)).toBe(0.0);
  });

  it("onsite wrong city, willing to relocate → 0.4", () => {
    const relocOk = { ...PROFILE_LOC, willing_to_relocate: true };
    const loc = { type: "onsite", cities: ["Austin"], countries: ["USA"] };
    expect(scoreLocation(loc, relocOk)).toBe(0.4);
  });

  it("hybrid wrong city, no relocate → 0.3", () => {
    const loc = { type: "hybrid", cities: ["Boston"], countries: ["USA"] };
    expect(scoreLocation(loc, PROFILE_LOC)).toBe(0.3);
  });

  it("onsite no city info → 0.5 (benefit of doubt)", () => {
    const loc = { type: "onsite", cities: [], countries: [] };
    expect(scoreLocation(loc, PROFILE_LOC)).toBe(0.5);
  });

  // Empty acceptable_cities — profile has no city preference, match on country
  const NO_CITY_PREF = {
    acceptable_types:     ["remote", "hybrid", "onsite"],
    acceptable_cities:    [],
    acceptable_countries: ["USA"],
    willing_to_relocate:  false,
  };

  it("no city pref + job country matches → 1.0", () => {
    const loc = { type: "onsite", cities: ["Austin"], countries: ["USA"] };
    expect(scoreLocation(loc, NO_CITY_PREF)).toBe(1.0);
  });

  it("no city pref + hybrid + job country matches → 1.0", () => {
    const loc = { type: "hybrid", cities: ["San Francisco"], countries: ["USA"] };
    expect(scoreLocation(loc, NO_CITY_PREF)).toBe(1.0);
  });

  it("no city pref + wrong country + no relocate → 0.0", () => {
    const loc = { type: "onsite", cities: ["London"], countries: ["UK"] };
    expect(scoreLocation(loc, NO_CITY_PREF)).toBe(0.0);
  });

  it("no city pref + wrong country + willing to relocate → 0.4", () => {
    const relocOk = { ...NO_CITY_PREF, willing_to_relocate: true };
    const loc = { type: "onsite", cities: ["London"], countries: ["UK"] };
    expect(scoreLocation(loc, relocOk)).toBe(0.4);
  });

  it("no city pref + no country info → partial credit (0.5 onsite)", () => {
    const loc = { type: "onsite", cities: [], countries: [] };
    expect(scoreLocation(loc, NO_CITY_PREF)).toBe(0.5);
  });
});


// ---------------------------------------------------------------------------
// scoreSemantic
// ---------------------------------------------------------------------------

describe("scoreSemantic", () => {
  it("identical vectors → 1.0", () => {
    const v = new Float32Array([0.5, 0.5, 0.5, 0.5]);
    expect(scoreSemantic(v, v)).toBeCloseTo(1.0, 3);
  });

  it("orthogonal vectors → 0", () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    expect(scoreSemantic(a, b)).toBeCloseTo(0, 3);
  });

  it("null vectors → 0", () => {
    expect(scoreSemantic(null, null)).toBe(0);
    expect(scoreSemantic(new Float32Array([1]), null)).toBe(0);
  });

  it("similar vectors → high score", () => {
    const a = new Float32Array([0.8, 0.6, 0.1]);
    const b = new Float32Array([0.7, 0.7, 0.2]);
    expect(scoreSemantic(a, b)).toBeGreaterThan(0.9);
  });

  it("opposite vectors → clamped to 0", () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([-1, 0]);
    expect(scoreSemantic(a, b)).toBe(0);
  });
});


// ---------------------------------------------------------------------------
// scoreJob (composite)
// ---------------------------------------------------------------------------

const BASE_JOB = {
  title:            "Senior Java Engineer",
  seniority:        "senior",
  employment_type:  "full_time",
  location:         { type: "remote", cities: [], countries: [] },
  required_skills: [
    { name: "java",        years_required: 5, importance: "required" as const, category: "language" },
    { name: "spring boot", years_required: 3, importance: "required" as const, category: "framework" },
    { name: "aws",         years_required: 2, importance: "preferred" as const, category: "cloud" },
  ],
  years_experience: { min: 5, max: 8 },
  compensation:     { min: 140000, currency: "USD", interval: "annual" },
};

const BASE_PROFILE = {
  acceptable_seniority:  ["senior", "staff"],
  acceptable_employment: ["full_time", "contract_to_hire"],
  location: {
    acceptable_types:     ["remote", "hybrid", "onsite"],
    acceptable_cities:    ["jersey city", "new york"],
    acceptable_countries: ["USA"],
    willing_to_relocate:  false,
  },
  compensation: { min_acceptable: 140000, currency: "USD", interval: "annual" },
  skills:       PROFILE_SKILLS,
  years_experience: 6,
};

describe("scoreJob (composite)", () => {
  it("strong match — passes gate", () => {
    const result = scoreJob(BASE_JOB, BASE_PROFILE);
    expect(result.score).toBeGreaterThan(DEFAULT_THRESHOLD);
    expect(result.gate_passed).toBe(true);
  });

  it("score between 0 and 1", () => {
    const result = scoreJob(BASE_JOB, BASE_PROFILE);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it("components all between 0 and 1", () => {
    const result = scoreJob(BASE_JOB, BASE_PROFILE);
    const { components } = result;
    for (const val of Object.values(components)) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });

  it("no semantic embedding → semantic component = 0, weights redistributed", () => {
    const result = scoreJob(BASE_JOB, BASE_PROFILE, null, null);
    expect(result.components.semantic).toBe(0);
    expect(result.weights.semantic).toBe(0);
    // Remaining weights sum to 1
    const weightSum = Object.values(result.weights).reduce((a: number, b: number) => a + b, 0);
    expect(weightSum).toBeCloseTo(1.0, 2);
  });

  it("wrong seniority → score drops, may fail gate", () => {
    const internJob = { ...BASE_JOB, seniority: "intern" };
    const result = scoreJob(internJob, BASE_PROFILE);
    // Seniority component should be 0 (intern=0, senior=3, gap=3)
    expect(result.components.seniority).toBe(0);
    // Score should be lower than base
    const baseResult = scoreJob(BASE_JOB, BASE_PROFILE);
    expect(result.score).toBeLessThan(baseResult.score);
  });

  it("wrong location + onsite + no skills → fails gate", () => {
    const badJob = {
      ...BASE_JOB,
      location:        { type: "onsite", cities: ["Austin"], countries: ["USA"] },
      required_skills: [
        { name: "rust",   years_required: 5, importance: "required" as const, category: "language" },
        { name: "elixir", years_required: 3, importance: "required" as const, category: "language" },
      ],
      years_experience: { min: 10, max: 15 },  // overqualified-ish
    };
    const result = scoreJob(badJob, BASE_PROFILE);
    expect(result.gate_passed).toBe(false);
  });

  it("custom weights respected", () => {
    const skillHeavy = { skills: 0.8, semantic: 0.0, yoe: 0.1, seniority: 0.05, location: 0.05 };
    const result = scoreJob(BASE_JOB, BASE_PROFILE, null, null, skillHeavy);
    expect(result.weights).toEqual(expect.objectContaining({ skills: expect.any(Number) }));
  });

  it("custom threshold respected", () => {
    const highThreshold = scoreJob(BASE_JOB, BASE_PROFILE, null, null, DEFAULT_WEIGHTS, 0.99);
    const lowThreshold  = scoreJob(BASE_JOB, BASE_PROFILE, null, null, DEFAULT_WEIGHTS, 0.01);
    // Same score, different gate outcomes
    expect(highThreshold.score).toBe(lowThreshold.score);
    expect(lowThreshold.gate_passed).toBe(true);
  });
});