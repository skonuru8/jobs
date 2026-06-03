/**
 * types.ts — resume generator contracts.
 */

import type { Job, Profile } from "@/filter/types";
import type { ScoreResult } from "@/scorer/types";
import type { ArtifactJudgeJson } from "@/shared/artifact-bundle";
import type { GapDirective, TechSwap } from "@/judge/types";
import type { PatchResult } from "./patch/types";

/**
 * Controls how the resume generator produces tailored LaTeX.
 *
 * - `patch_tailoring` (default) — sends only the relevant role blocks +
 *   directives to the LLM; model returns JSON ops only; canonical tex is
 *   spliced deterministically. ~75-90% token savings vs full_regen.
 * - `full_regen` — sends the full canonical tex and asks the model to return
 *   a complete tailored LaTeX document. Original total-mode path.
 */
export type ResumeMode = "patch_tailoring" | "full_regen";

export interface ResumeGenInput {
  job: Job;
  profile: Profile;
  canonical_resume_tex: string;
  jd_json: Record<string, unknown>;
  judge_json: ArtifactJudgeJson;
  score: { total: number; components: ScoreResult["components"] };
  canonical_sha: string;
  gap_directives?: GapDirective[];
  tech_swaps?: TechSwap[];
}

export interface ResumeGenResult {
  /** `ok` — tex produced (may include warnings). `error` — generation failed, tex is null. */
  status:       "ok" | "error";
  tex:          string | null;
  model:        string;
  /** SHA-256 (12 hex) of the system prompt used, for cache invalidation. */
  prompt_sha:   string;
  word_count:   number;
  tokens:       { input: number; output: number };
  generated_at: string;
  /**
   * Non-fatal issues present in the output. Known values:
   * - `banned_phrase_in_output` — style linter found a hedging phrase on final attempt
   * - `resume_patch_coverage_failed` — patch mode: ≥1 directive not covered after retry
   * - `tex_malformed` — brace count or missing begin/end{document}
   */
  warnings?:    string[];
  error?:       string;
  /** Populated in patch_tailoring mode only. */
  patch?:       PatchResult;
}

export interface ResumeGenConfig {
  /** Generation strategy. Defaults to `patch_tailoring` when absent. See `ResumeMode`. */
  mode?: ResumeMode;
  /** Default model (and flash fallback when premium fails). */
  model: string;
  /** Optional second fallback if both primary and premium models fail. */
  fallback_model?: string;
  /** Used instead of `model` when verdict=STRONG and score >= `premium_min_score`. */
  premium_model?: string;
  /** Minimum score (0–1) required to use the premium model. Default: 0.70. */
  premium_min_score?: number;
  /** Enable streaming for the premium model. Non-streaming for all others. */
  premium_stream?: boolean;
  /** Token ceiling for the LLM response. patch_tailoring caps at 1600 internally. */
  max_tokens: number;
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
  /** Extra attempts per model on style-lint or truncation failure (total = retries + 1). */
  retries: number;
  /** Flag `resume_too_short` if final word count is below this. Default: 1900. */
  word_count_min?: number;
  /** Flag `resume_too_long` if final word count exceeds this. Default: 2500. */
  word_count_max?: number;
}
