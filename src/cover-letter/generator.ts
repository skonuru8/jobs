/**
 * generator.ts — LLM call for cover letter body (prose only).
 */

import { complete } from "./client";
import { stripDashes } from "@/shared/dash-lint";
import { hasBannedStylePhrase } from "@/shared/style-lint";
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
    work_authorization: input.profile.work_authorization,
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

  const maxAttempts = (config.retries ?? 1) + 1;
  let lastErr: string | undefined;
  let currentUserPrompt = userPrompt;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await complete({
        model: config.model,
        messages: [
          { role: "system", content: COVER_LETTER_SYSTEM },
          { role: "user",   content: currentUserPrompt },
        ],
        max_tokens:  config.max_tokens,
        temperature: config.temperature,
        ...(config.thinking ? { thinking: config.thinking } : {}),
      });
      const cleaned = stripDashes(stripMarkdown(result.content));
      const wordCount = countWords(cleaned);
      const truncated = looksTruncated(cleaned);
      const bannedStyle = hasBannedStylePhrase(cleaned);

      if (cleaned && (wordCount < 350 || truncated || bannedStyle) && attempt < maxAttempts - 1) {
        const retryAddendum = `\n\nPREVIOUS OUTPUT WAS ${wordCount} WORDS${truncated ? " AND LOOKED TRUNCATED" : ""}${bannedStyle ? " AND USED BANNED BRIDGING STYLE" : ""}. Minimum 400 required. Generate a complete longer body. Address the judge's gap reframe angles in more depth. Add a fourth paragraph if needed. Do not return under 400 words. End with a complete sentence. Do not use bridging phrases such as analogous to, demonstrating transferable, similar to, or directly applicable to.`;
        currentUserPrompt = userPrompt + retryAddendum;
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
