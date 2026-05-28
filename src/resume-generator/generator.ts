/**
 * generator.ts — LLM tailored resume (.tex).
 */

import { complete } from "@/cover-letter/client";
import { stripLatex } from "@/cover-letter/resume";

import {
  hasExtendedJudgeContext,
  buildSlimJdForPrompts,
  buildSlimProfileForPrompts,
} from "@/shared/artifact-bundle";
import { findBannedStylePhrases } from "@/shared/style-lint";

import { PROMPT_SHA, TOTAL_MODE_PROMPT, renderResumeJudgeAddendum } from "./prompt";
import type { ResumeGenConfig, ResumeGenInput, ResumeGenResult } from "./types";

export async function generateResumeTex(
  input: ResumeGenInput,
  config: ResumeGenConfig,
  shortRetryHint?: string,
): Promise<ResumeGenResult> {
  const generated_at = new Date().toISOString();
  const userMsg = buildUserMessage(input, shortRetryHint);

  const usePremium = Boolean(
    config.premium_model &&
    input.judge_json.verdict === "STRONG" &&
    input.score.total >= (config.premium_min_score ?? 0.70),
  );

  const call = (model: string, stream: boolean) => complete({
    model,
    messages: [
      { role: "system", content: TOTAL_MODE_PROMPT },
      { role: "user",   content: userMsg },
    ],
    max_tokens:  config.max_tokens,
    temperature: config.temperature,
    stream,
    timeout_ms: stream ? 300_000 : undefined,
  });

  const primaryAttempts = usePremium
    ? [
        { model: config.premium_model!, stream: config.premium_stream ?? true },
        { model: config.model, stream: false },
        ...(config.fallback_model ? [{ model: config.fallback_model, stream: false }] : []),
      ]
    : [
        { model: config.model, stream: false },
        ...(config.fallback_model ? [{ model: config.fallback_model, stream: false }] : []),
      ];
  const attempts = dedupeAttempts(primaryAttempts);
  const maxPerModel = (config.retries ?? 1) + 1;
  let lastErr = "unknown";

  for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex++) {
    const attempt = attempts[attemptIndex];
    const attemptsForModel = usePremium && attempt.model === config.premium_model ? 1 : maxPerModel;
    for (let i = 0; i < attemptsForModel; i++) {
      const premiumTag = usePremium && attempt.model === config.premium_model
        ? ` (premium: score=${input.score.total.toFixed(3)} ${input.judge_json.verdict})`
        : "";
      const streamTag = attempt.stream ? " stream" : "";
      const retryTag = attemptsForModel > 1 ? ` attempt ${i + 1}/${attemptsForModel}` : "";
      console.log(`[resume] model: ${attempt.model}${premiumTag}${streamTag}${retryTag}`);
      try {
        const r = await call(attempt.model, attempt.stream);
        let tex = extractLatexDocument(stripFences(r.content).trim());
        tex = tex.replace(/^\uFEFF/, "");
        if (!tex.startsWith("\\documentclass")) {
          lastErr = `missing documentclass; first chars: ${stripFences(r.content).trim().slice(0, 160)}`;
          logPremiumFailure(
            usePremium,
            attempt.model,
            config.premium_model,
            lastErr,
            i < attemptsForModel - 1,
            attempts[attemptIndex + 1]?.model,
          );
          continue;
        }
        if (!/\end\{document\}\s*$/s.test(tex)) {
          lastErr = `missing end{document}; last chars: ${tex.slice(-160)}`;
          logPremiumFailure(
            usePremium,
            attempt.model,
            config.premium_model,
            lastErr,
            i < attemptsForModel - 1,
            attempts[attemptIndex + 1]?.model,
          );
          continue;
        }
        const banned = findBannedStylePhrases(tex);
        if (banned.length > 0) {
          lastErr = `banned style phrase: ${banned.join(", ")}`;
          logPremiumFailure(
            usePremium,
            attempt.model,
            config.premium_model,
            lastErr,
            i < attemptsForModel - 1,
            attempts[attemptIndex + 1]?.model,
          );
          continue;
        }
        const wc = countWordsTex(tex);
        return {
          status:       "ok",
          tex,
          model:        r.model,
          prompt_sha:   PROMPT_SHA,
          word_count:   wc,
          tokens:       { input: r.input_tokens ?? 0, output: r.output_tokens ?? 0 },
          generated_at,
        };
      } catch (e) {
        lastErr = String(e);
        logPremiumFailure(
          usePremium,
          attempt.model,
          config.premium_model,
          lastErr,
          i < attemptsForModel - 1,
          attempts[attemptIndex + 1]?.model,
        );
        if (i < attemptsForModel - 1) {
          await new Promise(res => setTimeout(res, 2000));
        }
      }
    }
  }

  return {
    status:       "error",
    tex:          null,
    model:        config.model,
    prompt_sha:   PROMPT_SHA,
    word_count:   0,
    tokens:       { input: 0, output: 0 },
    generated_at,
    error:        lastErr,
  };
}

function logPremiumFailure(
  usePremium: boolean,
  model: string,
  premiumModel: string | undefined,
  reason: string,
  willRetryPremium: boolean,
  fallbackModel: string | undefined,
): void {
  if (!(usePremium && model === premiumModel)) return;

  if (willRetryPremium) {
    console.warn(`[resume] premium model failed; retrying premium: ${reason.slice(0, 240)}`);
    return;
  }
  if (fallbackModel) {
    console.warn(`[resume] premium model failed; falling back to ${fallbackModel}: ${reason.slice(0, 240)}`);
    return;
  }
  console.warn(`[resume] premium model failed; no fallback remaining: ${reason.slice(0, 240)}`);
}

function dedupeAttempts(attempts: Array<{ model: string; stream: boolean }>): Array<{ model: string; stream: boolean }> {
  const seen = new Set<string>();
  return attempts.filter(a => {
    const key = `${a.model}:${a.stream ? "stream" : "plain"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildUserMessage(input: ResumeGenInput, shortHint?: string): string {
  const useSlim = hasExtendedJudgeContext(input.judge_json);
  const jdNames = (input.job.required_skills ?? []).map(s => s.name);
  const jdPayload = useSlim ? buildSlimJdForPrompts(input.jd_json) : input.jd_json;
  const profilePayload = useSlim
    ? buildSlimProfileForPrompts(input.profile, jdNames)
    : {
        skills: input.profile.skills,
        years_experience: input.profile.years_experience,
        education: input.profile.education,
        preferred_domains: input.profile.preferred_domains,
        contact: input.profile.contact,
        target_titles: input.profile.target_titles,
      };

  const parts = [
    "CANONICAL_RESUME:",
    input.canonical_resume_tex,
    "",
    "JD_JSON:",
    JSON.stringify(jdPayload, null, 2),
    "",
    "JUDGE_JSON:",
    JSON.stringify(input.judge_json, null, 2),
    "",
    "PROFILE_JSON:",
    JSON.stringify(profilePayload, null, 2),
    "",
    "SCORE_JSON:",
    JSON.stringify(input.score, null, 2),
  ];
  const judgeAddendum = renderResumeJudgeAddendum(
    input.gap_directives ?? input.judge_json.gap_directives,
    input.tech_swaps ?? input.judge_json.tailoring_hints?.tech_swaps,
  );
  if (judgeAddendum) {
    parts.push("", judgeAddendum);
  }
  if (shortHint) {
    parts.push("", "CRITICAL_ADDENDUM:", shortHint);
  }
  return parts.join("\n");
}

function stripFences(s: string): string {
  return s
    .replace(/^```(?:latex|tex)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function extractLatexDocument(s: string): string {
  const start = s.indexOf("\\documentclass");
  const end = s.lastIndexOf("\\end{document}");
  if (start < 0 || end < start) return s;
  return s.slice(start, end + "\\end{document}".length).trim();
}

function countWordsTex(tex: string): number {
  const plain = stripLatex(tex);
  return plain.split(/\s+/).filter(Boolean).length;
}

export function latexStructureOk(tex: string): boolean {
  const open = (tex.match(/\{/g) ?? []).length;
  const close = (tex.match(/\}/g) ?? []).length;
  if (Math.abs(open - close) > 3) return false;
  return tex.includes("\\begin{document}") && tex.includes("\\end{document}");
}
