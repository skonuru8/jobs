/**
 * types.ts — resume generator contracts.
 */

import type { Job, Profile } from "@/filter/types";
import type { ScoreResult } from "@/scorer/types";
import type { ArtifactJudgeJson } from "@/shared/artifact-bundle";
import type { GapDirective, TechSwap } from "@/judge/types";

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
  status:       "ok" | "error";
  tex:          string | null;
  model:        string;
  prompt_sha:   string;
  word_count:   number;
  tokens:       { input: number; output: number };
  generated_at: string;
  error?:       string;
}

export interface ResumeGenConfig {
  model: string;
  fallback_model?: string;
  premium_model?: string;
  premium_min_score?: number;
  premium_stream?: boolean;
  max_tokens: number;
  temperature: number;
  throttle_ms: number;
  compile_pdf: boolean;
  review_queue_threshold: number;
  retries: number;
  word_count_min?: number;
  word_count_max?: number;
}
