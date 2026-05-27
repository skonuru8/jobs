import { describe, expect, it } from "vitest";

import { stripDashes } from "@/shared/dash-lint";

describe("stripDashes", () => {
  it("rewrites LaTeX date range dashes as to", () => {
    expect(stripDashes("January 2025 -- June 2025")).toBe("January 2025 to June 2025");
    expect(stripDashes("2024 --- Present")).toBe("2024 to Present");
  });

  it("rewrites unicode en and em dashes", () => {
    expect(stripDashes("Built APIs — deployed services")).toBe("Built APIs, deployed services");
    expect(stripDashes("React – Angular")).toBe("React, Angular");
  });

  it("preserves single hyphens in words and separators", () => {
    expect(stripDashes("full-stack engineer - remote")).toBe("full-stack engineer - remote");
  });
});
