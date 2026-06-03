import { describe, expect, it } from "vitest";

import { applyPatchOps } from "@/resume-generator/patch/apply";
import { verifyPatchCoverage } from "@/resume-generator/patch/coverage";
import { extractRoleBlocks } from "@/resume-generator/patch/parser";
import { buildResumeSignature } from "@/resume-generator/signature";

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

    const coverage = verifyPatchCoverage(tex, [
      { handling: "fabricate", jd_requirement: "Kafka event handling", target_role: "ExampleCo", frame_as: "Kafka billing events" },
      { handling: "fabricate", jd_requirement: "Kubernetes deployment", target_role: "OtherCo", frame_as: "Kubernetes deployments" },
    ]);

    expect(coverage.covered).toBe(1);
    expect(coverage.missed).toEqual(["Kubernetes deployment"]);
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
