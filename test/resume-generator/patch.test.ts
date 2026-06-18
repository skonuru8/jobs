import { describe, expect, it } from "vitest";

import { applyPatchOps } from "@/resume-generator/patch/apply";
import { verifyPatchCoverage } from "@/resume-generator/patch/coverage";
import { activeGapDirectives } from "@/resume-generator/patch/generator";
import { extractRoleBlocks, extractRoleLabels, findRoleBlock } from "@/resume-generator/patch/parser";
import { buildResumeSignature } from "@/resume-generator/signature";
import { validateJudge } from "@/judge/validate";

const canonical = `
\\documentclass{article}
\\begin{document}
\\section*{SUMMARY}
\\begin{itemize}
\\item Summary stays untouched.
\\end{itemize}
\\section*{SKILLS}
Java, SQL
\\section*{EXPERIENCE}
\\textbf{ExampleCo} \\hfill 2024\\\\
\\textit{Engineer}
\\begin{itemize}
\\item Built Java APIs for billing workflows.
\\item Improved SQL reports by \\textbf{15\\%}.
\\end{itemize}

\\textbf{OtherCo} \\hfill 2023\\\\
\\textit{Developer}
\\begin{itemize}
\\item Maintained internal tools.
\\end{itemize}
\\section*{PROJECTS}
\\end{document}
`.trim();

describe("resume patch mode helpers", () => {
  it("extracts role blocks with 1-indexed items", () => {
    const blocks = extractRoleBlocks(canonical);

    expect(blocks.map(b => b.role)).toEqual(["ExampleCo", "OtherCo"]);
    expect(blocks[0].items.map(i => i.index)).toEqual([1, 2]);
    expect(blocks[0].items[0].text).toContain("Built Java APIs");
  });

  it("applies rewrite and insert ops inside the targeted role only", () => {
    const patched = applyPatchOps(canonical, [
      { type: "rewrite", role: "ExampleCo", item: 1, new_item: "\\item Engineered Java APIs for billing workflows with Spring Boot." },
      { type: "insert_after", role: "ExampleCo", after_item: 2, item: "\\item Delivered Kafka event handling for billing workflows." },
    ]);

    expect(patched).toContain("Engineered Java APIs");
    expect(patched).toContain("Delivered Kafka event handling");
    expect(patched).toContain("Maintained internal tools.");
    expect(patched).toContain("\\section*{SUMMARY}");
    expect(patched).toContain("\\section*{SKILLS}");
  });

  it("checks directive coverage only in the target role block", () => {
    const tex = applyPatchOps(canonical, [
      { type: "insert_first", role: "ExampleCo", item: "\\item Delivered Kafka event handling for billing workflows." },
    ]);

    const ops: import("../../src/resume-generator/patch/types").PatchOp[] = [
      { type: "insert_first", role: "ExampleCo", item: "\\item Delivered Kafka event handling for billing workflows." },
    ];
    const coverage = verifyPatchCoverage(tex, [
      { handling: "fabricate", jd_requirement: "Kafka event handling", target_role: "ExampleCo", frame_as: "Kafka billing events" },
      { handling: "fabricate", jd_requirement: "Kubernetes deployment", target_role: "OtherCo", frame_as: "Kubernetes deployments" },
    ], ops);

    expect(coverage.covered).toBe(1);
    expect(coverage.missed).toEqual(["Kubernetes deployment"]);
  });

  it("extractRoleLabels returns canonical label strings in source order", () => {
    const labels = extractRoleLabels(canonical);
    expect(labels).toEqual(["ExampleCo", "OtherCo"]);
  });

  it("findRoleBlock uses exact normalized equality — composite label does not match partial block", () => {
    const blocks = extractRoleBlocks(canonical);
    // "ExampleCo / OtherCo" should NOT match "ExampleCo"
    expect(findRoleBlock(blocks, "ExampleCo / OtherCo")).toBeNull();
    // Exact match works
    expect(findRoleBlock(blocks, "ExampleCo")).not.toBeNull();
  });

  it("activeGapDirectives skips directives without target_role", () => {
    const directives = [
      { handling: "fabricate" as const, jd_requirement: "Kafka", target_role: "ExampleCo", frame_as: null },
      { handling: "fabricate" as const, jd_requirement: "Kubernetes", target_role: null, frame_as: null },
      { handling: "acknowledge" as const, jd_requirement: "Docker", target_role: "ExampleCo", frame_as: null },
    ];
    const active = activeGapDirectives(directives);
    expect(active).toHaveLength(1);
    expect(active[0].jd_requirement).toBe("Kafka");
  });

  it("validateJudge gates composite label — downgraded to acknowledge with flag", () => {
    const rawJson = JSON.stringify({
      verdict: "STRONG",
      confidence: 0.9,
      reasoning: "Good fit",
      concerns: [],
      key_matches: [],
      gaps: [],
      gap_directives: [
        { jd_requirement: "Nokia CPQ", handling: "fabricate", target_role: "Hitachi Vantara / Nokia", frame_as: "Nokia project" },
      ],
      why_apply: null,
      tailoring_hints: {
        emphasize_roles: [],
        emphasize_skills: [],
        downplay_skills: [],
        domain_reframe_angle: null,
        tech_swaps: [],
        gap_directives: [],
      },
    });
    const allowedLabels = ["Hitachi Vantara", "Project: Nokia", "Project: PHIA", "Project: Nissan", "AquilaEdge LLC", "Persistent Systems"];
    const result = validateJudge(rawJson, allowedLabels);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const directive = result.data.gap_directives[0];
    expect(directive.handling).toBe("acknowledge");
    expect(directive.target_role).toBeNull();
    expect(result.data.concerns).toContain("directive_role_unresolved:Hitachi Vantara / Nokia");
  });

  it("validateJudge gates PHIA Group label — unresolvable role produces flag", () => {
    const rawJson = JSON.stringify({
      verdict: "MAYBE",
      confidence: 0.7,
      reasoning: "Partial fit",
      concerns: [],
      key_matches: [],
      gaps: [],
      gap_directives: [
        { jd_requirement: "healthcare appeals", handling: "reframe", target_role: "PHIA Group", frame_as: "PATS platform" },
      ],
      why_apply: null,
      tailoring_hints: {
        emphasize_roles: [],
        emphasize_skills: [],
        downplay_skills: [],
        domain_reframe_angle: null,
        tech_swaps: [],
        gap_directives: [],
      },
    });
    const allowedLabels = ["Hitachi Vantara", "Project: Nokia", "Project: PHIA", "Project: Nissan", "AquilaEdge LLC", "Persistent Systems"];
    const result = validateJudge(rawJson, allowedLabels);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.gap_directives[0].handling).toBe("acknowledge");
    expect(result.data.gap_directives[0].target_role).toBeNull();
    expect(result.data.concerns.some(c => c.includes("directive_role_unresolved"))).toBe(true);
  });

  it("validateJudge resolves exact Project: Nokia label — preserves and canonicalizes casing", () => {
    const rawJson = JSON.stringify({
      verdict: "STRONG",
      confidence: 0.95,
      reasoning: "Nokia CPQ fit",
      concerns: [],
      key_matches: [],
      gaps: [],
      gap_directives: [
        { jd_requirement: "CPQ microservices", handling: "fabricate", target_role: "Project: Nokia", frame_as: "Nokia CPQ context" },
      ],
      why_apply: null,
      tailoring_hints: {
        emphasize_roles: [],
        emphasize_skills: [],
        downplay_skills: [],
        domain_reframe_angle: null,
        tech_swaps: [],
        gap_directives: [],
      },
    });
    const allowedLabels = ["Hitachi Vantara", "Project: Nokia", "Project: PHIA", "Project: Nissan", "AquilaEdge LLC", "Persistent Systems"];
    const result = validateJudge(rawJson, allowedLabels);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.gap_directives[0].handling).toBe("fabricate");
    expect(result.data.gap_directives[0].target_role).toBe("Project: Nokia");
  });

  it("validateJudge drops swap with unresolved role and flags it", () => {
    const rawJson = JSON.stringify({
      verdict: "STRONG",
      confidence: 0.9,
      reasoning: "Strong fit",
      concerns: [],
      key_matches: [],
      gaps: [],
      gap_directives: [],
      why_apply: null,
      tailoring_hints: {
        emphasize_roles: [],
        emphasize_skills: [],
        downplay_skills: [],
        domain_reframe_angle: null,
        tech_swaps: [
          { from: "Camunda BPMN", to: "Flowable", confidence: 0.9, target_role: "PHIA Group" },
          { from: "Redis", to: "Memcached", confidence: 0.8, target_role: "Project: Nokia" },
        ],
        gap_directives: [],
      },
    });
    const allowedLabels = ["Hitachi Vantara", "Project: Nokia", "Project: PHIA", "Project: Nissan", "AquilaEdge LLC", "Persistent Systems"];
    const result = validateJudge(rawJson, allowedLabels);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Bad swap dropped; good swap kept
    expect(result.data.tailoring_hints.tech_swaps).toHaveLength(1);
    expect(result.data.tailoring_hints.tech_swaps[0].target_role).toBe("Project: Nokia");
    expect(result.data.concerns.some(c => c.includes("swap_role_unresolved"))).toBe(true);
  });

  it("coverage check uses exact findRoleBlock — deliberate-miss fixture reports NOT covered", () => {
    const tex = applyPatchOps(canonical, [
      { type: "insert_first", role: "ExampleCo", item: "\\item Added Kafka event handling for billing workflows." },
    ]);

    const ops2: import("../../src/resume-generator/patch/types").PatchOp[] = [
      { type: "insert_first", role: "ExampleCo", item: "\\item Added Kafka event handling for billing workflows." },
    ];
    const coverage = verifyPatchCoverage(tex, [
      { handling: "fabricate", jd_requirement: "Kafka", target_role: "ExampleCo", frame_as: "Kafka billing" },
      { handling: "fabricate", jd_requirement: "Kubernetes", target_role: "OtherCo", frame_as: "Kubernetes orchestration" },
    ], ops2);

    expect(coverage.covered).toBe(1);
    expect(coverage.missed).toContain("Kubernetes");
  });

  it("uses mode-specific prompt signatures", () => {
    const bundle = {
      canonical_sha: "canon",
      judge_json: {
        gap_directives: [{ handling: "reframe", jd_requirement: "Kafka", target_role: "ExampleCo", frame_as: "events" }],
        tailoring_hints: { tech_swaps: [{ from: "RabbitMQ", to: "Kafka", confidence: 0.8, target_role: null }] },
      },
    } as any;

    const patch = buildResumeSignature(bundle, { mode: "patch_tailoring" } as any);
    const full = buildResumeSignature(bundle, { mode: "full_regen" } as any);

    expect(patch.resume_mode).toBe("patch_tailoring");
    expect(full.resume_mode).toBe("full_regen");
    expect(patch.prompt_sha).not.toBe(full.prompt_sha);
    expect(patch.directives_hash).toBe(full.directives_hash);
  });
});
