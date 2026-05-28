import { describe, expect, it } from "vitest";

import { boldMetrics, replaceSkillsSection } from "@/resume-generator";

describe("replaceSkillsSection", () => {
  it("restores canonical skills section exactly", () => {
    const canonical = [
      "\\section*{SKILLS}",
      "\\textbf{Programming Languages:} Java, Python\\\\",
      "\\textbf{Testing Tools:} JUnit, Mockito\\\\",
      "\\section*{EXPERIENCE}",
      "canonical experience",
    ].join("\n");
    const generated = [
      "\\section*{SKILLS}",
      "\\textbf{Programming Languages:} Java, Python, Cypress\\\\",
      "\\section*{EXPERIENCE}",
      "tailored experience",
    ].join("\n");

    const out = replaceSkillsSection(generated, canonical);
    expect(out).toContain("\\textbf{Testing Tools:} JUnit, Mockito\\\\");
    expect(out).not.toContain("Cypress");
    expect(out).toContain("tailored experience");
  });
});

describe("boldMetrics", () => {
  it("bolds numeric outcomes in item lines only", () => {
    const tex = [
      "\\item Restored contract processing from 7 min to 1 min for 4 roles.",
      "January 2025 to Present",
    ].join("\n");

    const out = boldMetrics(tex);
    expect(out).toContain("\\textbf{7 min}");
    expect(out).toContain("\\textbf{1 min}");
    expect(out).toContain("\\textbf{4 roles}");
    expect(out).toContain("January 2025 to Present");
  });

  it("preserves already-bold metrics", () => {
    const tex = "\\item Reduced latency by \\textbf{85\\%} across 12 services.";
    const out = boldMetrics(tex);
    expect(out).toContain("\\textbf{85\\%}");
    expect(out).toContain("\\textbf{12 services}");
  });

  it("bolds escaped percent metrics emitted as plain LaTeX", () => {
    const tex = "\\item Raised pass rate by 85\\% across 120ms API checks.";
    const out = boldMetrics(tex);
    expect(out).toContain("\\textbf{85\\%}");
    expect(out).toContain("\\textbf{120ms}");
  });
});
