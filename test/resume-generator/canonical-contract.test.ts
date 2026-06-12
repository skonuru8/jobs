/**
 * canonical-contract.test.ts — Smoke test that the real canonical resume
 * satisfies the format contract assumed by parsers and role extractors.
 *
 * A resume edit that breaks the required LaTeX dialect (see docs/RESUME-FORMAT-CONTRACT.md)
 * fails this test immediately instead of producing silent empty-directive failures at runtime.
 */

import * as fs from "fs";
import * as path from "path";

import { describe, expect, it } from "vitest";

import { extractRolesFromCanonicalTex } from "@/judge/roles-extractor";
import { extractRoleBlocks, extractRoleLabels } from "@/resume-generator/patch/parser";

const CANONICAL_PATH = path.resolve(__dirname, "../../config/resume_master.tex");

describe("canonical resume format contract", () => {
  const tex = fs.existsSync(CANONICAL_PATH)
    ? fs.readFileSync(CANONICAL_PATH, "utf8")
    : null;

  it("canonical resume file exists", () => {
    expect(tex).not.toBeNull();
  });

  it("extractRoleBlocks finds >= 5 role blocks", () => {
    if (!tex) return;
    const blocks = extractRoleBlocks(tex);
    expect(blocks.length).toBeGreaterThanOrEqual(5);
  });

  it("extractRoleLabels includes at least one Project: block", () => {
    if (!tex) return;
    const labels = extractRoleLabels(tex);
    const projectLabels = labels.filter(l => l.startsWith("Project:"));
    expect(projectLabels.length).toBeGreaterThanOrEqual(1);
  });

  it("extractRolesFromCanonicalTex produces non-empty roles_list", () => {
    if (!tex) return;
    const rolesList = extractRolesFromCanonicalTex(tex);
    expect(rolesList.trim().length).toBeGreaterThan(0);
    // Sanity: should mention at least one employer section
    expect(rolesList).toMatch(/##\s+\w/);
  });

  it("extractRoleLabels contains expected canonical labels", () => {
    if (!tex) return;
    const labels = extractRoleLabels(tex);
    expect(labels).toContain("Project: Nokia");
    expect(labels).toContain("Project: PHIA");
    expect(labels).toContain("Project: Nissan");
    expect(labels).toContain("AquilaEdge LLC");
    expect(labels).toContain("Hitachi Vantara");
    expect(labels).toContain("Persistent Systems");
  });
});
