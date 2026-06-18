/**
 * judge.ts — judge-stage orchestration for job-fit verdict generation.
 *
 * Renders judge prompts, calls model with bounded retry behavior, validates
 * structured JSON output, and captures failure payloads for later debugging.
 * Also exposes final-bucket routing logic shared by pipeline consumers.
 *
 * Called by: scripts/run-pipeline.ts
 * Writes to: `output/logs/judge_failures/*.json` on validation failure
 * Side effects: LLM API calls, retry delays, filesystem writes for bad payload capture
 */

import { complete, type ChatMessage, type ReasoningConfig } from "./client";
import * as fs from "fs";
import * as path from "path";
import {
  buildSystemPrompt,
  buildJudgePrompt,
  computeSystemPromptSha,
  PROMPT_VERSION,
} from "./prompt";
import { extractSkillsSectionFromCanonical } from "./roles-extractor";
import { validateJudge } from "./validate";
import type { JudgeInput, JudgeResult, FinalBucket, JudgeFields } from "./types";

export interface JudgeConfig {
  /** Provider model identifier to send to `complete`. */
  model:       string;
  /** Max completion tokens reserved for judge JSON response. */
  max_tokens:  number;
  /** Sampling temperature for verdict generation. */
  temperature: number;
  /** Reserved throttle value for caller-level pacing between jobs. */
  throttle_ms: number;
  /** Optional provider-specific reasoning config forwarded to client call. */
  reasoning?:  ReasoningConfig;
}

/**
 * Runs judge stage end to end and returns validated structured result.
 *
 * First prompt attempt may be retried once for transient HTTP failure and once
 * more after schema-validation failure. Invalid final payloads are captured to
 * disk so prompt/schema regressions can be audited without crashing pipeline.
 *
 * @param input - Normalized job facts, scorer output, and optional resume/profile context.
 * @param config - Model and generation settings for judge call.
 * @returns Success payload with parsed fields, or error payload with audit metadata.
 */
export async function judge(
  input:  JudgeInput,
  config: JudgeConfig,
): Promise<JudgeResult> {
  const judged_at  = new Date().toISOString();
  const userPrompt = buildJudgePrompt(input);
  const profile = input.profile;
  const systemPrompt = buildSystemPrompt(profile, input.roles_list, input.canonical_skills, input.allowed_role_labels);
  const systemPromptSha = computeSystemPromptSha(systemPrompt);

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
    },
    { role: "user", content: userPrompt },
  ];
  const call = () => complete({
    model:       config.model,
    messages,
    max_tokens:  config.max_tokens,
    temperature: config.temperature,
    ...(config.reasoning ? { reasoning: config.reasoning } : {}),
  });

  let raw: string;
  let model: string;
  let totalInputTokens  = 0;
  let totalOutputTokens = 0;
  try {
    const r1 = await _withHttpRetry(call);
    raw   = r1.content;
    model = r1.model;
    totalInputTokens  += r1.input_tokens  ?? 0;
    totalOutputTokens += r1.output_tokens ?? 0;
  } catch (e: any) {
    return {
      status:            "error",
      fields:              null,
      verdict:             null,
      model:               config.model,
      prompt_version:      PROMPT_VERSION,
      system_prompt_sha:   systemPromptSha,
      judged_at,
      error:               `LLM call failed: ${e?.message ?? e}`,
    };
  }

  const allowedLabels = input.allowed_role_labels;
  let validation = validateJudge(raw, allowedLabels);

  if (!validation.ok) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const r2 = await _withHttpRetry(call);
      raw   = r2.content;
      model = r2.model;
      totalInputTokens  += r2.input_tokens  ?? 0;
      totalOutputTokens += r2.output_tokens ?? 0;
    } catch (e: any) {
      return {
        status:            "error",
        fields:            null,
        verdict:           null,
        model:             config.model,
        prompt_version:    PROMPT_VERSION,
        system_prompt_sha: systemPromptSha,
        judged_at,
        error:             `LLM call failed (retry): ${e?.message ?? e}`,
      };
    }
    validation = validateJudge(raw, allowedLabels);
  }

  if (!validation.ok) {
    writeJudgeFailurePayload(input, raw, validation.error);
    return {
      status:            "error",
      fields:            null,
      verdict:           null,
      model,
      prompt_version:    PROMPT_VERSION,
      system_prompt_sha: systemPromptSha,
      judged_at,
      error:             validation.error,
      input_tokens:      totalInputTokens  || undefined,
      output_tokens:     totalOutputTokens || undefined,
    };
  }

  return {
    status:            "ok",
    fields:            validation.data as JudgeFields,
    verdict:           validation.data.verdict,
    model,
    prompt_version:    PROMPT_VERSION,
    system_prompt_sha: systemPromptSha,
    judged_at,
    input_tokens:      totalInputTokens  || undefined,
    output_tokens:     totalOutputTokens || undefined,
  };
}

/**
 * Persists raw invalid judge payload for later debugging.
 *
 * File writes are best-effort only; any failure here is swallowed because
 * observability must not convert recoverable judge miss into pipeline crash.
 *
 * @param input - Judge input used to derive stable run/job identifiers.
 * @param raw - Raw model response that failed validation.
 * @param error - Validation error explaining why payload was rejected.
 */
function writeJudgeFailurePayload(input: JudgeInput, raw: string, error: string): void {
  try {
    const runId = sanitizeId(input.run_id ?? "manual");
    const jobId = sanitizeId(input.job_id ?? input.job.title ?? "unknown-job");
    const dir = path.join(process.cwd(), "output", "logs", "judge_failures");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${runId}_${jobId}.json`),
      JSON.stringify({
        run_id: input.run_id ?? null,
        job_id: input.job_id ?? null,
        title: input.job.title,
        company: input.job.company,
        error,
        raw,
      }, null, 2) + "\n",
      "utf8",
    );
  } catch {
    // Failure capture must never turn a judge validation miss into a pipeline crash.
  }
}

/**
 * Converts arbitrary run/job labels into filename-safe tokens.
 *
 * @param value - Raw identifier from caller or job metadata.
 * @returns Sanitized string limited to 120 characters and safe for log filenames.
 */
function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "unknown";
}

/**
 * Retries single async operation once after short fixed delay.
 *
 * Used only for provider calls where transient HTTP/network failures are more
 * common than deterministic prompt/schema failures.
 *
 * @param fn - Async operation to execute and, on failure, retry once.
 * @returns Result of first successful invocation.
 * @throws Rethrows second failure from `fn` after retry delay expires.
 */
async function _withHttpRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    await new Promise(r => setTimeout(r, 2000));
    return await fn();
  }
}

/**
 * Maps judge result and deterministic score to pipeline routing bucket.
 *
 * Keeps routing policy centralized so UI and batch pipeline agree on when to
 * generate artifacts versus only surfacing result or archiving it.
 *
 * @param judgeResult - Validated or failed judge-stage outcome.
 * @param totalScore - Deterministic total score on 0-1 scale from scorer stage.
 * @returns Final bucket controlling artifact generation and UI visibility.
 */
export function getBucket(
  judgeResult: JudgeResult,
  totalScore:  number,
): FinalBucket {
  if (judgeResult.status === "error" || !judgeResult.verdict) return "ARCHIVE";

  switch (judgeResult.verdict) {
    case "STRONG": return totalScore >= 0.70 ? "COVER_LETTER" : "RESULTS";
    case "MAYBE":  return "REVIEW_QUEUE";
    case "WEAK":   return "ARCHIVE";
  }
}
