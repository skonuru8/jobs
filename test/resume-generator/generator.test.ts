import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/cover-letter/client", () => ({
  complete: vi.fn(),
}));

import { complete } from "@/cover-letter/client";
import { generateResumeTex } from "@/resume-generator/generator";
import { generatePatchedResumeTex } from "@/resume-generator/patch/orchestrator";
import type { ResumeGenConfig, ResumeGenInput } from "@/resume-generator/types";

const mockComplete = vi.mocked(complete);

const baseInput = {
  job: { required_skills: [] },
  profile: {},
  canonical_resume_tex: "\\documentclass{article}\\begin{document}Canonical\\end{document}",
  jd_json: { required_skills: [], responsibilities: [] },
  judge_json: { verdict: "MAYBE", reasoning: "ok", concerns: [] },
  score: {
    total: 0.6,
    components: { skills: 0.6, semantic: 0.6, yoe: 1, seniority: 1, location: 1 },
  },
  canonical_sha: "abc123",
} as unknown as ResumeGenInput;

const config: ResumeGenConfig = {
  model: "test-model",
  max_tokens: 1000,
  temperature: 0.2,
  throttle_ms: 0,
  compile_pdf: false,
  review_queue_threshold: 0.7,
  retries: 0,
};

function doc(body: string): string {
  return `\\documentclass{article}
\\begin{document}
${body}
\\end{document}`;
}

describe("generateResumeTex", () => {
  beforeEach(() => {
    mockComplete.mockReset();
  });

  it("accepts final-attempt banned phrase output with warning", async () => {
    mockComplete.mockResolvedValueOnce({
      content: doc("\\item Gained hands-on exposure to Docker."),
      model: "test-model",
      input_tokens: 10,
      output_tokens: 20,
    });

    const result = await generateResumeTex(baseInput, config);

    expect(result.status).toBe("ok");
    expect(result.warnings).toContain("banned_phrase_in_output");
    expect(result.tex).toContain("Gained hands-on exposure");
  });

  it("retries banned phrase output before the final attempt", async () => {
    mockComplete
      .mockResolvedValueOnce({
        content: doc("\\item Gained hands-on exposure to Docker."),
        model: "test-model",
        input_tokens: 10,
        output_tokens: 20,
      })
      .mockResolvedValueOnce({
        content: doc("\\item Contributed to Docker deployment orchestration."),
        model: "test-model",
        input_tokens: 11,
        output_tokens: 21,
      });

    const result = await generateResumeTex(baseInput, { ...config, retries: 1 });

    expect(result.status).toBe("ok");
    expect(result.warnings).toBeUndefined();
    expect(result.tex).toContain("Contributed to Docker");
    expect(mockComplete).toHaveBeenCalledTimes(2);
  });

  it("turns invalid patch JSON into an error result", async () => {
    mockComplete
      .mockResolvedValueOnce({
        content: "not json",
        model: "test-model",
        input_tokens: 10,
        output_tokens: 5,
      })
      .mockResolvedValueOnce({
        content: "{",
        model: "test-model",
        input_tokens: 11,
        output_tokens: 6,
      });

    const result = await generatePatchedResumeTex({
      ...baseInput,
      canonical_resume_tex: doc(`
\\section*{EXPERIENCE}
\\textbf{ExampleCo} \\hfill 2024\\\\
\\textit{Engineer}
\\begin{itemize}
\\item Built Java APIs.
\\end{itemize}
`),
      gap_directives: [
        { handling: "reframe", jd_requirement: "Kafka", target_role: "ExampleCo", frame_as: "event handling" },
      ],
    } as ResumeGenInput, config);

    expect(result.status).toBe("error");
    expect(result.error).toContain("patch op generation failed");
    expect(mockComplete).toHaveBeenCalledTimes(2);
  });
});
