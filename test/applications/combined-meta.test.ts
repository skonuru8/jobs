import fs from "fs";
import os from "os";
import path from "path";

import { describe, expect, it } from "vitest";

import { writeCombinedMeta } from "@/applications/combined-meta";

describe("writeCombinedMeta", () => {
  it("preserves failed resume and cover details", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "combined-meta-"));
    const jobDir = path.join(root, "job");
    const bundle = {
      job: {
        title: "Senior Developer",
        company: { name: "ExampleCo" },
        location: { cities: [], countries: [] },
        domain: null,
        meta: { job_id: "job-1", source_url: "https://example.test/job" },
      },
      judge_json: {
        verdict: "STRONG",
        confidence: 0.9,
        reasoning: "Good match",
        concerns: [],
        key_matches: [],
        gaps: [],
        gap_directives: [],
        why_apply: null,
        tailoring_hints: {},
      },
      score: { total: 0.82 },
      canonical_sha: "sha",
    } as any;

    const metaPath = writeCombinedMeta(
      jobDir,
      root,
      bundle,
      {
        tex_path: null,
        pdf_path: null,
        meta_path: null,
        meta: {
          model: "deepseek/deepseek-v4-pro",
          prompt_sha: "resume-sha",
          input_tokens: 10,
          output_tokens: 20,
          compile_status: "failed",
          error: "missing documentclass",
        },
        flags: ["resume_gen_failed"],
        word_count: 0,
      },
      {
        tex_path: null,
        pdf_path: null,
        meta_path: null,
        meta: {
          model: "deepseek/deepseek-v4-flash",
          prompt_sha: "cover-sha",
          input_tokens: 30,
          output_tokens: 40,
          compile_status: "failed",
          error: "truncated output",
        },
        flags: ["cover_letter_gen_failed"],
        word_count: 86,
      },
      { runId: "run-1", bucket: "COVER_LETTER", generatedBy: "pipeline" },
    );

    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    expect(meta.resume).toMatchObject({
      model: "deepseek/deepseek-v4-pro",
      compile_status: "failed",
      flags: ["resume_gen_failed"],
      error: "missing documentclass",
      tex_path: null,
    });
    expect(meta.cover_letter).toMatchObject({
      model: "deepseek/deepseek-v4-flash",
      compile_status: "failed",
      flags: ["cover_letter_gen_failed"],
      error: "truncated output",
      word_count: 86,
      tex_path: null,
    });
  });
});
