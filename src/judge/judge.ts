/**
 * judge.ts — LLM judge stage. Bible §5 stages 13–14.
 *
 * Inputs:  structured job fields + score breakdown (NOT raw JD text).
 * Output:  { verdict: STRONG|MAYBE|WEAK, reasoning, concerns[] }
 * Retry:
 *   - HTTP layer: 1 retry on timeout/network error (2s backoff).
 *   - Validation layer: 1 retry on Zod failure (2s backoff).
 *
 * Routing after verdict (getBucket):
 *   STRONG + score >= 0.70  → COVER_LETTER
 *   STRONG + score <  0.70  → RESULTS
 *   MAYBE                   → REVIEW_QUEUE
 *   WEAK                    → ARCHIVE
 */

import { complete, ReasoningConfig }          from "./client";
import { SYSTEM_PROMPT, buildJudgePrompt, PROMPT_VERSION } from "./prompt";
import { validateJudge }                     from "./validate";
import type { JudgeInput, JudgeResult, FinalBucket } from "./types";

export interface JudgeConfig {
  model:       string;
  max_tokens:  number;
  temperature: number;
  throttle_ms: number;
  reasoning?:  ReasoningConfig;
}

// ---------------------------------------------------------------------------
// Main judge function
// ---------------------------------------------------------------------------

export async function judge(
  input:  JudgeInput,
  config: JudgeConfig,
): Promise<JudgeResult> {
  const judged_at  = new Date().toISOString();
  const userPrompt = buildJudgePrompt(input);

  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const,   content: userPrompt },
  ];
  const call = () => complete({
    model:       config.model,
    messages,
    max_tokens:  config.max_tokens,
    temperature: config.temperature,
    ...(config.reasoning ? { reasoning: config.reasoning } : {}),
  });

  // First attempt with HTTP-level retry on network failure.
  let raw: string;
  let model: string;
  try {
    ({ content: raw, model } = await _withHttpRetry(call));
  } catch (e: any) {
    return {
      status:         "error",
      fields:         null,
      verdict:        null,
      model:          config.model,
      prompt_version: PROMPT_VERSION,
      judged_at,
      error:          `LLM call failed: ${e?.message ?? e}`,
    };
  }

  let validation = validateJudge(raw);

  // Retry once on validation failure (bible spec).
  if (!validation.ok) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      ({ content: raw, model } = await _withHttpRetry(call));
    } catch (e: any) {
      return {
        status:         "error",
        fields:         null,
        verdict:        null,
        model:          config.model,
        prompt_version: PROMPT_VERSION,
        judged_at,
        error:          `LLM call failed (retry): ${e?.message ?? e}`,
      };
    }
    validation = validateJudge(raw);
  }

  if (!validation.ok) {
    return {
      status:         "error",
      fields:         null,
      verdict:        null,
      model,
      prompt_version: PROMPT_VERSION,
      judged_at,
      error:          validation.error,
    };
  }

  return {
    status:         "ok",
    fields:         validation.data,
    verdict:        validation.data.verdict,
    model,
    prompt_version: PROMPT_VERSION,
    judged_at,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

// 1 retry on HTTP/network errors (timeout, 5xx, connection reset).
// Does NOT retry on validation failure — that happens a layer up.
async function _withHttpRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    await new Promise(r => setTimeout(r, 2000));
    return await fn();
  }
}

// ---------------------------------------------------------------------------
// Routing — map judge verdict + score to final bucket
// ---------------------------------------------------------------------------

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
