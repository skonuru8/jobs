import { describe, it, expect } from "vitest";
import {
  routeJob,
  hasUsableDescription,
  MIN_USABLE_JD_CHARS,
} from "@/pipeline/routing";

describe("hasUsableDescription", () => {
  it("rejects empty/null/undefined", () => {
    expect(hasUsableDescription("")).toBe(false);
    expect(hasUsableDescription(null)).toBe(false);
    expect(hasUsableDescription(undefined)).toBe(false);
  });

  it("rejects below threshold", () => {
    expect(hasUsableDescription("x".repeat(MIN_USABLE_JD_CHARS - 1))).toBe(false);
  });

  it("accepts threshold length", () => {
    expect(hasUsableDescription("x".repeat(MIN_USABLE_JD_CHARS))).toBe(true);
  });

  it("trims whitespace", () => {
    expect(hasUsableDescription(`   ${"x".repeat(10)}   `)).toBe(false);
  });
});

describe("routeJob", () => {
  it("archives semantic dup and skips judge", () => {
    const r = routeJob({
      doExtract: true,
      extractStatus: "ok",
      scored: true,
      gatePassed: true,
      isSemanticDuplicate: true,
    });
    expect(r.gateVerdict).toBe("GATE_PASS");
    expect(r.isArchived).toBe(true);
    expect(r.shouldJudge).toBe(false);
  });

  it("judges normal gate pass", () => {
    const r = routeJob({
      doExtract: true,
      extractStatus: "ok",
      scored: true,
      gatePassed: true,
      isSemanticDuplicate: false,
    });
    expect(r.isArchived).toBe(false);
    expect(r.shouldJudge).toBe(true);
  });

  it("archives extraction failure", () => {
    const r = routeJob({
      doExtract: true,
      extractStatus: "error",
      scored: false,
      gatePassed: false,
      isSemanticDuplicate: false,
    });
    expect(r.extractionFailed).toBe(true);
    expect(r.gateVerdict).toBe("ARCHIVE");
    expect(r.shouldJudge).toBe(false);
  });
});
