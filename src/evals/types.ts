/**
 * types.ts — Eval result contracts persisted into meta.json under `evals`.
 *
 * All fields are deterministic (no LLM required). The `net_quality` verdict on
 * EmphasisOpEval is derived from `info_loss` and `tech_forward_gain` locally,
 * and can be overridden by an optional LLM scorer without changing this schema.
 *
 * Called by: evals/runner.ts, applications/combined-meta.ts
 * Writes to: nothing
 * Side effects: none
 */

export type Quality = "improved" | "neutral" | "degraded";
export type OverallQuality = "ok" | "warning" | "fail";

export interface EmphasisOpEval {
  role: string;
  /** 1-indexed bullet position in canonical role block. */
  item: number;
  original: string;
  rewritten: string;
  scores: {
    /** 0–1: fraction of original content phrases retained in the rewrite. */
    specificity_preserved: number;
    /** 0–1: fraction of EMPHASIS_SKILLS terms newly bolded vs already present. */
    tech_forward_gain: number;
    /** true when any original content phrase is absent from the rewrite. */
    info_loss: boolean;
    /** degraded when info_loss; improved when tech_forward_gain > 0 and no loss; neutral otherwise. */
    net_quality: Quality;
  };
  /** Content phrases present in original but missing from rewrite (audit trail). */
  dropped_phrases: string[];
}

export interface DirectiveOpEval {
  role: string;
  jd_requirement: string;
  handling: "fabricate" | "reframe";
  scores: {
    /** Directive target term appears in produced bullet. */
    requirement_addressed: boolean;
    /** Bullet introduces a metric (number/percentage) not present in source role block. */
    metric_overclaim: boolean;
    banned_phrase: boolean;
  };
}

export interface ResumeEval {
  emphasis_ops: EmphasisOpEval[];
  directive_ops: DirectiveOpEval[];
  /** All flags from patch result and diff-lint. */
  flags: string[];
  overall_quality: OverallQuality;
}

export interface CoverLetterEval {
  word_count: number;
  banned_phrase: boolean;
  banned_phrases_found: string[];
  overall_quality: OverallQuality;
}

export interface EvalResult {
  run_at: string;
  /** Schema version for forward compatibility. */
  version: "1.0";
  /** SHA of the patch prompt that produced this resume (for trend attribution). */
  patch_prompt_sha: string | null;
  /** SHA of the cover letter prompt (for trend attribution). */
  cover_prompt_sha: string | null;
  resume: ResumeEval | null;
  cover_letter: CoverLetterEval | null;
}

/** Per-job row in a batch summary. */
export interface BatchJobRow {
  job_id: string;
  company: string;
  title: string;
  resume_quality: OverallQuality | "skipped";
  cover_quality: OverallQuality | "skipped";
  degraded_emphasis_ops: number;
  dropped_phrases: string[];
  flags: string[];
}

export interface BatchSummary {
  batch_id: string;
  run_at: string;
  total: number;
  pass: number;
  warn: number;
  fail: number;
  /** patch_prompt_sha → count of degraded emphasis ops attributed to it. */
  degraded_by_patch_prompt_sha: Record<string, number>;
  jobs: BatchJobRow[];
}
