import { describe, expect, it } from "vitest";

import { segmentJd } from "@/extractor/segment";

describe("segmentJd", () => {
  it("separates required and preferred sections", () => {
    const jd = `About us

Requirements:
- Strong programming skills
- Java

Preferred Qualifications:
- AWS is a plus
- Hibernate is a plus

Responsibilities:
- Build services`;

    const segments = segmentJd(jd);
    expect(segments.required).toContain("Java");
    expect(segments.preferred).toContain("AWS");
    expect(segments.preferred).toContain("Hibernate");
    expect(segments.responsibilities).toContain("Build services");
  });

  it("detects top-of-JD tech chip lines", () => {
    const jd = `Java | AWS | Hibernate | Spring Framework | Software Testing

About the role
Build backend services.`;

    const segments = segmentJd(jd);
    expect(segments.tags_chips).toContain("Java");
    expect(segments.tags_chips).toContain("Spring Framework");
  });
});
