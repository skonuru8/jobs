import { describe, expect, it } from "vitest";

import { validateJudge } from "@/judge/validate";
import { hasExtendedJudgeContext } from "@/shared/artifact-bundle";

describe("judge v5 schema compatibility", () => {
  const strictBase = {
    verdict: "STRONG",
    reasoning: "Good fit.",
    concerns: [],
    confidence: null,
    key_matches: [],
    gaps: [],
    gap_directives: [],
    why_apply: null,
    tailoring_hints: {
      emphasize_roles: [],
      emphasize_skills: [],
      downplay_skills: [],
      domain_reframe_angle: null,
      tech_swaps: [],
      gap_directives: [],
    },
  };

  it("accepts strict judge output with empty arrays and consumers stay safe", () => {
    const raw = JSON.stringify(strictBase);

    const result = validateJudge(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.gap_directives).toEqual([]);
      expect(() => hasExtendedJudgeContext({
        verdict: result.data.verdict,
        reasoning: result.data.reasoning,
        concerns: result.data.concerns,
        gap_directives: result.data.gap_directives,
        tailoring_hints: result.data.tailoring_hints,
      })).not.toThrow();
    }
  });

  it("accepts strict judge output with unscoped tech_swaps", () => {
    const raw = JSON.stringify({
      ...strictBase,
      tailoring_hints: {
        ...strictBase.tailoring_hints,
        tech_swaps: [{ from: "React", to: "Angular", confidence: 0.9, target_role: null }],
      },
    });

    const result = validateJudge(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.tailoring_hints.tech_swaps[0].target_role).toBeNull();
    }
  });

  it("accepts v5 judge output with empty gap_directives", () => {
    const raw = JSON.stringify({
      ...strictBase,
      verdict: "MAYBE",
      reasoning: "Partial fit.",
      concerns: ["Missing one stack item."],
      tailoring_hints: {
        ...strictBase.tailoring_hints,
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
      ...strictBase,
      verdict: "MAYBE",
      reasoning: "Several gaps.",
      concerns: ["Needs careful tailoring."],
      gap_directives: [
        { jd_requirement: "Cassandra", handling: "fabricate", target_role: "Project: PHIA", frame_as: "High-throughput NoSQL stores for contract data." },
        { jd_requirement: "MongoDB", handling: "reframe", target_role: "Project: Nokia", frame_as: "Document-style data access patterns alongside Cosmos DB." },
        { jd_requirement: "Capital markets", handling: "acknowledge", target_role: "Persistent Systems", frame_as: "Adjacent enterprise platform work in regulated domains." },
        { jd_requirement: "Kotlin", handling: "ignore", target_role: null, frame_as: null },
        { jd_requirement: "FX trading", handling: "forbid", target_role: null, frame_as: null },
      ],
      tailoring_hints: {
        ...strictBase.tailoring_hints,
        tech_swaps: [
          { from: "React", to: "Angular", confidence: 0.8, target_role: "Project: PHIA" },
        ],
      },
    });

    const result = validateJudge(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.gap_directives).toHaveLength(5);
      expect(result.data.tailoring_hints?.tech_swaps?.[0]?.target_role).toBe("Project: PHIA");
    }
  });

  it("rejects malformed handling values", () => {
    const raw = JSON.stringify({
      ...strictBase,
      verdict: "MAYBE",
      reasoning: "Several gaps.",
      gap_directives: [
        {
          jd_requirement: "Cassandra",
          handling: "definitely_fabricate",
          target_role: "Project: PHIA",
          frame_as: "NoSQL stores.",
        },
      ],
    });

    const result = validateJudge(raw);
    expect(result.ok).toBe(false);
  });
});
