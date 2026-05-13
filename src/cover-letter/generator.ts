/**
 * generator.ts — LLM call for cover letter body (prose only).
 */

import { complete } from "./client";
import {
  COVER_LETTER_SYSTEM,
  COVER_PROMPT_SHA,
  PROMPT_VERSION,
  appendStructuredJsonSections,
  buildCoverLetterPrompt,
} from "./prompt";
import type { CoverLetterInput, CoverLetterResult, CoverLetterConfig } from "./types";

export async function generateCoverLetter(
  input: CoverLetterInput,
  config: CoverLetterConfig,
  jdJson?: Record<string, unknown>,
  judgeJson?: Record<string, unknown> | null,
  profileForPrompt?: Record<string, unknown>,
): Promise<CoverLetterResult> {
  const generated_at = new Date().toISOString();
  const jd = jdJson ?? {
    title: input.job.title,
    company: input.job.company,
    domain: input.job.domain,
    required_skills: input.job.required_skills,
    responsibilities: input.job.responsibilities,
  };
  const judge = judgeJson ?? {
    verdict: null as string | null,
    reasoning: input.job.judge_reasoning,
    concerns: input.job.judge_concerns,
  };
  const base = buildCoverLetterPrompt(input);
  const profileDoc = profileForPrompt ?? {
    skills: input.profile.skills,
    years_experience: input.profile.years_experience,
    education: input.profile.education,
    preferred_domains: input.profile.preferred_domains,
    contact: input.profile.contact,
    title: input.profile.title,
    location_line: input.profile.location_line,
  };
  const userPrompt = appendStructuredJsonSections(
    base,
    jd,
    judge,
    profileDoc,
  );

  const call = (model: string) => complete({
    model,
    messages: [
      { role: "system", content: COVER_LETTER_SYSTEM },
      { role: "user",   content: userPrompt },
    ],
    max_tokens:  config.max_tokens,
    temperature: config.temperature,
    ...(config.thinking ? { thinking: config.thinking } : {}),
  });

  const maxAttempts = (config.retries ?? 1) + 1;
  let lastErr: string | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await call(config.model);
      const cleaned = stripMarkdown(result.content);
      const wordCount = countWords(cleaned);
      return {
        status:         "ok",
        text:           cleaned,
        model:          result.model,
        prompt_version: PROMPT_VERSION,
        prompt_sha:     COVER_PROMPT_SHA,
        generated_at,
        word_count:     wordCount,
        input_tokens:   result.input_tokens,
        output_tokens:  result.output_tokens,
      };
    } catch (e) {
      lastErr = String(e);
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

function countWords(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^```[\w]*\n?/gm, "")
    .replace(/^```\s*$/gm, "")
    .replace(/^#{1,3}\s+.+\n?/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
