import { describe, expect, it } from "vitest";

import { replaceSkillsSection } from "@/resume-generator";

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
