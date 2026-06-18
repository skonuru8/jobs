import { describe, it, expect } from "vitest";
import { isTruncationError, repairTruncatedJson } from "@/shared/json-repair";

function parseError(input: string): unknown {
  try { JSON.parse(input); return null; }
  catch (e) { return e; }
}

describe("isTruncationError", () => {
  const truncated = [
    '{"a": "b',
    '{"a": 1,',
    '{"a":',
    '[1, 2,',
    '[1, 2',
    '',
    '{"a": tru',
    '{"a": 12',
    '{"a',
  ];
  for (const input of truncated) {
    it(`detects truncation for ${JSON.stringify(input)}`, () => {
      expect(isTruncationError(parseError(input))).toBe(true);
    });
  }

  it("returns false for non-SyntaxError", () => {
    expect(isTruncationError(new Error("boom"))).toBe(false);
    expect(isTruncationError(null)).toBe(false);
    expect(isTruncationError("string")).toBe(false);
  });
});

describe("repairTruncatedJson", () => {
  const cases: Array<[string, string, unknown?]> = [
    ["mid-string",            '{"a": "b',                     { a: "b" }],
    ["object trailing comma", '{"a": 1,',                     { a: 1 }],
    ["after key colon",       '{"a":',                        {}],
    ["after key colon space", '{"a": ',                       {}],
    ["array trailing comma",  '[1, 2,',                       [1, 2]],
    ["array no comma",        '[1, 2',                        [1, 2]],
    ["mid-number",            '{"a": 12',                     { a: 12 }],
    ["mid-literal",           '{"a": tru',                    {}],
    ["mid-key",               '{"a',                          {}],
    ["nested",                '{"a": {"b": [1, 2',            { a: { b: [1, 2] } }],
    ["string with comma",     '{"a": "hello, wor',            { a: "hello, wor" }],
    ["second literal trunc",  '{"a": true, "b": fal',         { a: true }],
    ["negative sign only",    '{"a": -',                      {}],
    ["already valid",         '{"a": 1}',                     { a: 1 }],
    ["array of objects",      '{"items": [{"id": 1}, {"id":', { items: [{ id: 1 }, {}] }],
  ];

  for (const [name, input, expected] of cases) {
    it(`repairs ${name} into valid JSON`, () => {
      const repaired = repairTruncatedJson(input);
      const parsed = JSON.parse(repaired);
      if (expected !== undefined) expect(parsed).toEqual(expected);
    });
  }

  it("leaves complete JSON unchanged", () => {
    expect(JSON.parse(repairTruncatedJson('{"x": [1, {"y": "z"}]}'))).toEqual({ x: [1, { y: "z" }] });
  });
});
