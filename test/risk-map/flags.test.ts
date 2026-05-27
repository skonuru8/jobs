import { describe, expect, it } from "vitest";

import { applyResumeAttributionOverrunFlag } from "@/risk-map";
import type { RiskSummary } from "@/risk-map";

function summary(count: number): Pick<RiskSummary, "counts"> {
  return {
    counts: {
      exact: 0,
      reworded: 0,
      direct_equivalent: 0,
      adjacent: 0,
      unsupported_inference: 0,
      fabricated: 0,
      fabricated_role_attribution: count,
    },
  };
}

describe("applyResumeAttributionOverrunFlag", () => {
  it("adds flag when fabricated role attribution exceeds threshold", () => {
    const flags: string[] = [];
    applyResumeAttributionOverrunFlag(flags, summary(5));
    expect(flags).toContain("resume_attribution_overrun");
  });

  it("does not add flag at or below threshold", () => {
    const flags: string[] = [];
    applyResumeAttributionOverrunFlag(flags, summary(3));
    expect(flags).not.toContain("resume_attribution_overrun");
  });
});
