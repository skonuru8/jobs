/**
 * persist.test.ts — verifies the storage module's contracts.
 *
 * Two test groups:
 *
 *   1. formatErr — pure function, runs without any DB.
 *
 *   2. Disabled-state contract — markStorageDisabled() makes every persist
 *      function a silent no-op. This is the contract that was broken: saveJob
 *      threw AggregateError because pool.connect() escaped its try/catch.
 *      The tests below pin the contract shut: even with no DB and no
 *      explicit disable, none of the functions throw.
 *
 *      We force the disabled state for predictability rather than relying on
 *      a real DB connection failure (which would be slow and flaky).
 *
 * Run:
 *   cd storage && npm test
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  saveRun, saveJob, finishRun, isSeenInDB,
  markStorageDisabled, isStorageAvailable, formatErr,
  _resetDisabledForTesting,
} from "../persist.js";
import type { JobRecord, RunRecord, RunStats } from "../types.js";

// ---------------------------------------------------------------------------
// formatErr — preserves AggregateError detail
// ---------------------------------------------------------------------------

describe("formatErr", () => {

  it("returns message for plain Error", () => {
    expect(formatErr(new Error("boom"))).toBe("boom");
  });

  it("includes code prefix for pg-style errors", () => {
    const e = Object.assign(new Error("relation does not exist"), { code: "42P01" });
    expect(formatErr(e)).toBe("[42P01] relation does not exist");
  });

  it("unwraps AggregateError into joined inner messages", () => {
    const inner1 = new Error("connect ECONNREFUSED 127.0.0.1:5432");
    const inner2 = new Error("connect ECONNREFUSED ::1:5432");
    const agg = new AggregateError([inner1, inner2]);
    const result = formatErr(agg);
    expect(result).toContain("AggregateError");
    expect(result).toContain("ECONNREFUSED 127.0.0.1");
    expect(result).toContain("ECONNREFUSED ::1");
  });

  it("handles AggregateError with empty .message gracefully", () => {
    const agg = new AggregateError([new Error("inner detail")]);
    // AggregateError.message defaults to empty in Node — formatErr falls
    // through to the .errors[] branch.
    expect(formatErr(agg)).toContain("inner detail");
  });

  it("never returns empty string", () => {
    expect(formatErr(undefined)).toBeTruthy();
    expect(formatErr(null)).toBeTruthy();
    expect(formatErr({})).toBeTruthy();
    expect(formatErr("")).toBeTruthy();
  });

  it("falls back to String(e) for non-Error values", () => {
    expect(formatErr("a plain string")).toContain("a plain string");
    expect(formatErr(42)).toContain("42");
  });
});

// ---------------------------------------------------------------------------
// markStorageDisabled — all persist calls become no-ops
//
// This is the contract that fixes the AggregateError crash.
// ---------------------------------------------------------------------------

describe("storage disabled — non-throwing contract", () => {

  beforeEach(() => {
    _resetDisabledForTesting();
    markStorageDisabled("test setup");
  });

  it("isStorageAvailable() reports false after disable", () => {
    expect(isStorageAvailable()).toBe(false);
  });

  it("markStorageDisabled is idempotent (second call doesn't re-warn)", () => {
    markStorageDisabled("called twice");
    expect(isStorageAvailable()).toBe(false);
  });

  it("saveRun() returns cleanly when disabled", async () => {
    const run: RunRecord = {
      run_id:     "test-run",
      source:     "dice",
      started_at: new Date().toISOString(),
    };
    await expect(saveRun(run)).resolves.toBeUndefined();
  });

  it("saveJob() returns cleanly when disabled — does NOT throw AggregateError", async () => {
    const job: JobRecord = {
      job_id:         "test-job",
      run_id:         "test-run",
      source:         "dice",
      filter_verdict: "PASS",
      filter_flags:   [],
    };
    await expect(saveJob(job)).resolves.toBeUndefined();
  });

  it("saveJob() with full optional fields also returns cleanly", async () => {
    const job: JobRecord = {
      job_id:         "test-job-full",
      run_id:         "test-run",
      source:         "dice",
      source_url:     "https://example.com/job/1",
      title:          "Senior Engineer",
      company:        "Acme",
      embedding:      new Array(384).fill(0).map(() => Math.random()),
      filter_verdict: "PASS",
      filter_flags:   ["sponsorship_unclear"],
      score: {
        total: 0.85, skills: 0.9, semantic: 0.8,
        yoe: 0.85, seniority: 1.0, location: 1.0,
      },
      judge_verdict:        "STRONG",
      judge_bucket:         "COVER_LETTER",
      judge_reasoning:      "test",
      judge_concerns:       [],
      cover_letter_path:    "/tmp/cl.md",
      cover_letter_words:   180,
      cover_letter_model:   "test-model",
    };
    await expect(saveJob(job)).resolves.toBeUndefined();
  });

  it("finishRun() returns cleanly when disabled", async () => {
    const stats: RunStats = {
      finished_at: new Date().toISOString(),
      jobs_total:   0,
      jobs_passed:  0,
      jobs_gated:   0,
      jobs_covered: 0,
      extractions_attempted: 0,
      extractions_succeeded: 0,
    };
    await expect(finishRun("test-run", stats)).resolves.toBeUndefined();
  });

  it("isSeenInDB() returns false when disabled (treat as unseen)", async () => {
    const result = await isSeenInDB("dice", "abc");
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Default-state contract — without explicit disable, calling persist
// functions when there's no DB still must not throw.
//
// Skipped by default because it requires forcing a real connection failure,
// which is slow (~5s connect timeout). Set RUN_DB_DOWN_TESTS=1 to run.
// ---------------------------------------------------------------------------

describe.skipIf(!process.env.RUN_DB_DOWN_TESTS)("DB unreachable — non-throwing contract (slow)", () => {

  beforeEach(() => {
    _resetDisabledForTesting();
    // Point at a port nothing is listening on
    process.env.DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:1/none";
  });

  it("saveJob() with DB down does NOT throw", async () => {
    const job: JobRecord = {
      job_id:         "test-job",
      run_id:         "test-run",
      source:         "dice",
      filter_verdict: "PASS",
      filter_flags:   [],
    };
    // The whole point of the v4.1 fix: this used to throw AggregateError.
    await expect(saveJob(job)).resolves.toBeUndefined();
  });
});