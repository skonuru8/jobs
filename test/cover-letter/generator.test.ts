import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CoverLetterInput } from "@/cover-letter/types";

vi.mock("@/cover-letter/client", () => ({
  complete: vi.fn(),
}));

import { complete } from "@/cover-letter/client";
import { generateCoverLetter } from "@/cover-letter/generator";

const mockComplete = vi.mocked(complete);

const input: CoverLetterInput = {
  job: {
    job_id: "job-1",
    title: "Senior Java Engineer",
    company: "ExampleCo",
    domain: "fintech",
    employment_type: "full_time",
    required_skills: [{ name: "Java", importance: "required", years_required: 5 }],
    responsibilities: ["Build payment services"],
    yoe_min: 5,
    yoe_max: 8,
    visa_sponsorship: "unmentioned",
    visa_quote: null,
    score: 0.8,
    score_components: { skills: 0.8, semantic: 0.7, yoe: 1, seniority: 1, location: 1 },
    judge_reasoning: "Strong Java fit.",
    judge_concerns: [],
    location_line: null,
    req_id: null,
  },
  profile: {
    skills: [{ name: "Java", years: 6, confidence: "expert", category: "language" }],
    years_experience: 6,
    education: { degree: "master", field: "Computer Science" },
    preferred_domains: ["fintech"],
    work_authorization: {
      requires_sponsorship: true,
      visa_type: "F-1 OPT",
      clearance_eligible: false,
      cover_letter_phrasing_sponsorship_needed: "I am authorized to work in the United States on F-1 OPT and will require H-1B sponsorship at the standard transition point.",
      cover_letter_phrasing_no_sponsorship_needed: "",
    },
    contact: {
      name: "Test User",
      email: "test@example.com",
      phone: "555-0100",
      linkedin: "linkedin.com/in/test",
      github: "github.com/test",
      city: "New York",
      state: "NY",
    },
    title: "Senior Software Engineer",
    location_line: "New York, NY",
  },
  resume: "Built Java payment services.",
};

describe("generateCoverLetter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockComplete.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not charge content-quality attempt on empty content error", async () => {
    const body = Array.from({ length: 410 }, (_, i) => `word${i}`).join(" ") + ".";
    mockComplete
      .mockRejectedValueOnce(new Error("OpenRouter returned empty content"))
      .mockResolvedValueOnce({
        content: body,
        model: "test-model",
        input_tokens: 10,
        output_tokens: 20,
      });

    const resultPromise = generateCoverLetter(input, {
      model: "test-model",
      max_tokens: 1000,
      temperature: 0.2,
      throttle_ms: 0,
      retries: 0,
    });

    await vi.advanceTimersByTimeAsync(3000);
    const result = await resultPromise;

    expect(result.status).toBe("ok");
    expect(mockComplete).toHaveBeenCalledTimes(2);
  });
});
