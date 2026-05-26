import { describe, expect, it } from "vitest";

import { validateJudge } from "@/judge/validate";
import { hasExtendedJudgeContext } from "@/shared/artifact-bundle";

describe("judge v5 schema compatibility", () => {
  it("accepts old judge output without gap_directives and consumers stay safe", () => {
    const raw = JSON.stringify({
      verdict: "STRONG",
      reasoning: "Good fit.",
      concerns: [],
      tailoring_hints: {
        tech_swaps: [{ from: "React", to: "Angular", confidence: 0.9 }],
      },
    });

    const result = validateJudge(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.gap_directives).toBeUndefined();
      expect(() => hasExtendedJudgeContext({
        verdict: result.data.verdict,
        reasoning: result.data.reasoning,
        concerns: result.data.concerns,
        tailoring_hints: result.data.tailoring_hints,
      })).not.toThrow();
    }
  });

  it("accepts old judge output with unscoped tech_swaps", () => {
    const raw = JSON.stringify({
      verdict: "STRONG",
      reasoning: "Good fit.",
      concerns: [],
      tailoring_hints: {
        tech_swaps: [{ from: "React", to: "Angular", confidence: 0.9 }],
      },
    });

    const result = validateJudge(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.tailoring_hints?.tech_swaps?.[0]?.target_role).toBeUndefined();
    }
  });

  it("accepts v5 judge output with empty gap_directives", () => {
    const raw = JSON.stringify({
      verdict: "MAYBE",
      reasoning: "Partial fit.",
      concerns: ["Missing one stack item."],
      gap_directives: [],
      tailoring_hints: {
        tech_swaps: [],
      },
    });

    const result = validateJudge(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.gap_directives).toEqual([]);
    }
  });

  it("accepts one of each handling value", () => {
    const raw = JSON.stringify({
      verdict: "MAYBE",
      reasoning: "Several gaps.",
      concerns: ["Needs careful tailoring."],
      gap_directives: [
        { jd_requirement: "Cassandra", handling: "fabricate", target_role: "PHIA Group", frame_as: "High-throughput NoSQL stores for contract data." },
        { jd_requirement: "MongoDB", handling: "reframe", target_role: "Hitachi Vantara / Nokia", frame_as: "Document-style data access patterns alongside Cosmos DB." },
        { jd_requirement: "Capital markets", handling: "acknowledge", target_role: "Persistent Systems", frame_as: "Adjacent enterprise platform work in regulated domains." },
        { jd_requirement: "Kotlin", handling: "ignore", target_role: null, frame_as: null },
        { jd_requirement: "FX trading", handling: "forbid", target_role: null, frame_as: null },
      ],
      tailoring_hints: {
        tech_swaps: [
          { from: "React", to: "Angular", confidence: 0.8, target_role: "PHIA Group" },
        ],
      },
    });

    const result = validateJudge(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.gap_directives).toHaveLength(5);
      expect(result.data.tailoring_hints?.tech_swaps?.[0]?.target_role).toBe("PHIA Group");
    }
  });

  it("rejects malformed handling values", () => {
    const raw = JSON.stringify({
      verdict: "MAYBE",
      reasoning: "Several gaps.",
      concerns: [],
      gap_directives: [
        {
          jd_requirement: "Cassandra",
          handling: "definitely_fabricate",
          target_role: "PHIA Group",
          frame_as: "NoSQL stores.",
        },
      ],
    });

    const result = validateJudge(raw);
    expect(result.ok).toBe(false);
  });
});
