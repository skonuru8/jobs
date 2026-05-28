import { describe, it, expect } from "vitest";
import { parseBoolEnv } from "@/pipeline/env";

describe("parseBoolEnv", () => {
  it("parses false-like values", () => {
    expect(parseBoolEnv("0")).toBe(false);
    expect(parseBoolEnv("false")).toBe(false);
    expect(parseBoolEnv("no")).toBe(false);
    expect(parseBoolEnv("")).toBe(false);
    expect(parseBoolEnv(undefined)).toBe(false);
  });

  it("parses true-like values", () => {
    expect(parseBoolEnv("1")).toBe(true);
    expect(parseBoolEnv("true")).toBe(true);
    expect(parseBoolEnv("yes")).toBe(true);
  });

  it("supports default override", () => {
    expect(parseBoolEnv(undefined, true)).toBe(true);
    expect(parseBoolEnv("", true)).toBe(true);
  });
});
