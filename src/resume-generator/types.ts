/**
 * types.ts — Resume generator input, output, and config contracts.
 *
 * Defines stable shapes shared across resume prompt building, LLM generation,
 * patch orchestration, signature hashing, and artifact persistence.
 *
 * Called by: `generator.ts`, `index.ts`, `patch/orchestrator.ts`, signature/cache layers
 * Writes to: nothing
 * Side effects: none
 */

import type { Job, Profile } from "@/filter/types";
import type { ScoreResult } from "@/scorer/types";
import type { ArtifactJudgeJson } from "@/shared/artifact-bundle";
import type { GapDirective, TechSwap } from "@/judge/types";
import type { PatchResult } from "./patch/types";

/**
 * Controls which resume-generation path owns final LaTeX output.
 */
export type ResumeMode =
  /** Deterministic patch path: LLM returns JSON ops against canonical LaTeX. Default mode. */
  | "patch_tailoring"
  /** Full-regeneration path: LLM returns an entire LaTeX document in one response. */
  | "full_regen";

export interface ResumeGenInput {
  /** Normalized job payload whose requirements drive tailoring decisions. */
  job: Job;
  /** Candidate profile used to constrain claims, stack, and target-title framing. */
  profile: Profile;
  /** Canonical resume source that all tailoring must preserve or patch from. */
  canonical_resume_tex: string;
  /** Raw job-description JSON consumed by prompt builders and cache signatures. */
  jd_json: Record<string, unknown>;
  /** Judge verdict and tailoring guidance that authorize resume changes. */
  judge_json: ArtifactJudgeJson;
  /** Aggregate score plus component breakdown used for model selection and gating. */
  score: { total: number; components: ScoreResult["components"] };
  /** Stable canonical resume hash used for cache invalidation and artifact metadata. */
  canonical_sha: string;
  /** Optional explicit bullet directives when caller wants to bypass judge-json fallback lookup. */
  gap_directives?: GapDirective[];
  /** Optional scoped tech replacements applied during tailoring and section cleanup. */
  tech_swaps?: TechSwap[];
}

export interface ResumeGenResult {
  /** Generation outcome: `ok` returns LaTeX, `error` returns metadata plus failure reason. */
  status:
    /** Tailoring produced a LaTeX payload, though warnings may still be present. */
    | "ok"
    /** Tailoring failed and no usable LaTeX document is available. */
    | "error";
  /** Final LaTeX document, or `null` when generation never produced a usable result. */
  tex:          string | null;
  /** Model ID that produced the accepted output or last attempted error result. */
  model:        string;
  /** SHA-256 (12 hex) of the system prompt used, for cache invalidation. */
  prompt_sha:   string;
  /** Approximate rendered word count after stripping LaTeX commands. */
  word_count:   number;
  /** Token accounting from provider response metadata. */
  tokens:       {
    /** Prompt/input tokens billed for accepted or terminal attempt. */
    input: number;
    /** Completion/output tokens billed for accepted or terminal attempt. */
    output: number;
  };
  /** ISO timestamp captured before generation attempts begin. */
  generated_at: string;
  /**
   * Non-fatal issues present in the output. Known values:
   * - `banned_phrase_in_output` — style linter found a hedging phrase on final attempt
   * - `resume_patch_coverage_failed` — patch mode: ≥1 directive not covered after retry
   * - `tex_malformed` — brace count or missing begin/end{document}
   */
  warnings?:    string[];
  /** Terminal error string when `status` is `error`. */
  error?:       string;
  /** Populated in patch_tailoring mode only. */
  patch?:       PatchResult;
}

export interface ResumeGenConfig {
  /** Generation strategy. Defaults to `patch_tailoring` when absent. See `ResumeMode`. */
  mode?: ResumeMode;
  /** Primary model for all patch and full_regen generation. */
  model: string;
  /** Fallback model used on exception (timeout / empty content). */
  fallback_model?: string;
  /** Token ceiling for the LLM response (full_regen path). */
  max_tokens: number;
  /**
   * Token ceiling used specifically in patch_tailoring mode. Lets you tune the
   * budget per model without touching code — reasoning-heavy models (Pro) need
   * more headroom before emitting JSON than lighter models (Flash). Falls back
   * to `max_tokens` when absent.
   */
  patch_max_tokens?: number;
  /** Sampling temperature passed to model completion call. Lower is more deterministic. */
  temperature: number;
  /** Milliseconds to wait before the LLM call, to avoid rate-limit bursts. */
  throttle_ms: number;
  /** Compile .tex → .pdf after generation. Set false to skip latexmk for speed. */
  compile_pdf: boolean;
  /**
   * Minimum score for REVIEW_QUEUE bucket jobs to receive artifact generation.
   * COVER_LETTER bucket always qualifies regardless of score.
   */
  review_queue_threshold: number;
  /**
   * Emit `resume_patch_ops_explosion` warning when a single job's op count exceeds this.
   * Catches over-editing (typically from the fallback model). Default: 12.
   */
  patch_ops_warn_threshold?: number;
  /** Extra attempts per model on style-lint or truncation failure (total = retries + 1). */
  retries: number;
  /** Flag `resume_too_short` if final word count is below this. Default: 1900. */
  word_count_min?: number;
  /** Flag `resume_too_long` if final word count exceeds this. Default: 2500. */
  word_count_max?: number;
}
