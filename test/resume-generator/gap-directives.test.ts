import { describe, expect, it } from "vitest";

import { TOTAL_MODE_PROMPT, renderResumeGapDirectives, renderResumeJudgeAddendum, renderResumeScopedTechSwaps } from "@/resume-generator/prompt";

describe("resume generator gap directives", () => {
  it("omits gap section when gap_directives is empty", () => {
    expect(renderResumeGapDirectives([])).toBe("");
  });

  it("renders fabricate directives with role and framing", () => {
    const rendered = renderResumeGapDirectives([
      {
        jd_requirement: "MongoDB",
        handling: "fabricate",
        target_role: "Project: Nokia",
        frame_as: "Document-style persistence for high-throughput contract data.",
      },
    ]);
    expect(rendered).toContain("[FABRICATE] MongoDB");
    expect(rendered).toContain("at role: Project: Nokia");
    expect(rendered).toContain("frame as: Document-style persistence");
  });

  it("includes forbidden list items", () => {
    const rendered = renderResumeGapDirectives([
      {
        jd_requirement: "FX trading",
        handling: "forbid",
        target_role: null,
        frame_as: null,
      },
    ]);
    expect(rendered).toContain("FORBIDDEN");
    expect(rendered).toContain("FX trading");
  });

  it("scopes tech swaps to the target role when present", () => {
    const rendered = renderResumeScopedTechSwaps([
      {
        from: "MongoDB",
        to: "Cosmos DB",
        confidence: 0.8,
        target_role: "Project: Nokia",
      },
    ]);
    expect(rendered).toContain("MongoDB -> Cosmos DB");
    expect(rendered).toContain("apply only at role: Project: Nokia");
  });

  it("leaves tech swaps unscoped when target_role is null", () => {
    const rendered = renderResumeScopedTechSwaps([
      {
        from: "React",
        to: "Angular",
        confidence: 0.9,
        target_role: null,
      },
    ]);
    expect(rendered).toContain("apply anywhere if relevant");
  });

  it("combines swaps and directives into one addendum", () => {
    const rendered = renderResumeJudgeAddendum(
      [
        {
          jd_requirement: "MongoDB",
          handling: "fabricate",
          target_role: "Project: Nokia",
          frame_as: "Document-style persistence for high-throughput contract data.",
        },
      ],
      [
        {
          from: "React",
          to: "Angular",
          confidence: 0.9,
          target_role: null,
        },
      ],
    );
    expect(rendered).toContain("JUDGE TECH SWAPS");
    expect(rendered).toContain("JUDGE GAP DIRECTIVES");
  });

  it("includes quality gates in the total-mode prompt", () => {
    expect(TOTAL_MODE_PROMPT).toContain("SUMMARY RELEVANCE GATE");
    expect(TOTAL_MODE_PROMPT).toContain("BULLET QUALITY GATE");
    expect(TOTAL_MODE_PROMPT).toContain("PROJECT PLACEMENT AND SCOPE");
  });

  it("guards against contradictions and fabrication inflation", () => {
    expect(TOTAL_MODE_PROMPT).toContain("must not contradict the role's canonical");
    expect(TOTAL_MODE_PROMPT).toContain("incompatible stacks/deployments");
    expect(TOTAL_MODE_PROMPT).toContain("may appear in at most ONE experience bullet");
    expect(TOTAL_MODE_PROMPT).toContain("Do not elevate it into");
  });

  it("requires banned phrases to be rewritten from any source", () => {
    expect(TOTAL_MODE_PROMPT).toContain("regardless of source");
    expect(TOTAL_MODE_PROMPT).toContain("inherited from a canonical");
    expect(TOTAL_MODE_PROMPT).toContain("suggested by a frame_as");
    expect(TOTAL_MODE_PROMPT).toContain("only remove the hedge");
  });
});
