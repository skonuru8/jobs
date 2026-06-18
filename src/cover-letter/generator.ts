/**
 * generator.ts — LLM call for cover letter body (prose only).
 */

import { complete, type ChatMessage } from "./client";
import { stripDashes } from "@/shared/dash-lint";
import { findBannedStylePhrases, hasBannedStylePhrase } from "@/shared/style-lint";
import {
  COVER_LETTER_SYSTEM,
  COVER_PROMPT_SHA,
  PROMPT_VERSION,
  appendJudgeSection,
  buildCoverLetterPrompt,
} from "./prompt";
import type { CoverLetterInput, CoverLetterResult, CoverLetterConfig } from "./types";

export async function generateCoverLetter(
  input: CoverLetterInput,
  config: CoverLetterConfig,
  _jdJson?: Record<string, unknown>,
  judgeJson?: Record<string, unknown> | null,
  _profileForPrompt?: Record<string, unknown>,
): Promise<CoverLetterResult> {
  const generated_at = new Date().toISOString();
  const judge = judgeJson ?? {
    verdict: null as string | null,
    reasoning: input.job.judge_reasoning,
    concerns: input.job.judge_concerns,
  };
  const base = buildCoverLetterPrompt(input);
  const userPrompt = appendJudgeSection(base, judge);

  const maxAttempts = (config.retries ?? 1) + 1;
  const maxApiErrors = 2;
  let lastErr: string | undefined;
  let lastOutput = "";
  let retryAddendum = "";
  let apiErrorCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const systemMessage: ChatMessage = {
        role: "system",
        content: [
          {
            type: "text",
            text: COVER_LETTER_SYSTEM,
            cache_control: { type: "ephemeral" },
          },
        ],
      };
      const retryMessages: ChatMessage[] = [
        systemMessage,
        { role: "user",      content: userPrompt },
        { role: "assistant", content: lastOutput },
        { role: "user",      content: retryAddendum.trim() },
      ];
      const messages: ChatMessage[] = attempt > 0 && lastOutput
        ? retryMessages
        : [
          systemMessage,
          { role: "user", content: userPrompt },
        ];
      const result = await complete({
        model: config.model,
        messages,
        max_tokens:  config.max_tokens,
        temperature: config.temperature,
        ...(config.thinking ? { thinking: config.thinking } : {}),
      });
      totalInputTokens  += result.input_tokens  ?? 0;
      totalOutputTokens += result.output_tokens ?? 0;

      const cleaned = stripDashes(stripMarkdown(result.content));
      lastOutput = cleaned;
      const wordCount = countWords(cleaned);
      const truncated = looksTruncated(cleaned);
      const bannedHits = findBannedStylePhrases(cleaned);
      const bannedStyle = bannedHits.length > 0;

      // short CLs always retry on attempt 0; quality issues retry on any non-final attempt
      const shouldRetryShort = wordCount < 350 && attempt === 0;
      const shouldRetryQuality = (truncated || bannedStyle) && attempt < maxAttempts - 1;
      if (cleaned && (shouldRetryShort || shouldRetryQuality)) {
        const bannedClause = bannedStyle
          ? ` Your previous output contained these BANNED phrases — remove each one and state the fact directly instead: ${bannedHits.map(p => `"${p}"`).join(", ")}.`
          : "";
        retryAddendum = `\n\nPREVIOUS OUTPUT WAS ${wordCount} WORDS${truncated ? " AND LOOKED TRUNCATED" : ""}${bannedStyle ? " AND USED BANNED BRIDGING STYLE" : ""}. Minimum 400 required. Generate a complete longer body. Address the judge's gap reframe angles in more depth. Add a fourth paragraph if needed. Do not return under 400 words. End with a complete sentence.${bannedClause}`;
        continue;
      }

      if (truncated) {
        lastErr = `cover letter body appears truncated (${wordCount} words)`;
        continue;
      }

      if (bannedStyle) {
        lastErr = "cover letter body contains banned style phrase";
        continue;
      }

      return {
        status:         "ok",
        text:           cleaned,
        model:          result.model,
        prompt_version: PROMPT_VERSION,
        prompt_sha:     COVER_PROMPT_SHA,
        generated_at,
        word_count:     wordCount,
        input_tokens:   totalInputTokens,
        output_tokens:  totalOutputTokens,
      };
    } catch (e) {
      const msg = String(e);
      lastErr = msg;
      const isTransient = msg.includes("empty content") ||
                          msg.includes("terminated") ||
                          msg.includes("OpenRouter API error 5");
      if (isTransient && apiErrorCount < maxApiErrors) {
        apiErrorCount++;
        attempt--;
        await new Promise(r => setTimeout(r, 3000 * apiErrorCount));
        continue;
      }
      if (attempt < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  return {
    status:         "error",
    text:           null,
    model:          config.model,
    prompt_version: PROMPT_VERSION,
    prompt_sha:     COVER_PROMPT_SHA,
    generated_at,
    error:          lastErr ?? "unknown error",
  };
}

export function countWords(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

export function looksTruncated(body: string): boolean {
  const t = body.trim();
  if (!t) return true;
  return !/[.!?"]$/.test(t);
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^```[\w]*\n?/gm, "")
    .replace(/^```\s*$/gm, "")
    .replace(/^#{1,3}\s+.+\n?/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
