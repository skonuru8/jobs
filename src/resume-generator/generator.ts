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

import { PROMPT_SHA, TOTAL_MODE_PROMPT, renderResumeJudgeAddendum } from "./prompt";
import type { ResumeGenConfig, ResumeGenInput, ResumeGenResult } from "./types";

export async function generateResumeTex(
  input: ResumeGenInput,
  config: ResumeGenConfig,
  shortRetryHint?: string,
): Promise<ResumeGenResult> {
  const generated_at = new Date().toISOString();
  const userMsg = buildUserMessage(input, shortRetryHint);

  const call = (model: string) => complete({
    model,
    messages: [
      { role: "system", content: TOTAL_MODE_PROMPT },
      { role: "user",   content: userMsg },
    ],
    max_tokens:  config.max_tokens,
    temperature: config.temperature,
  });

  const uniqModels = [...new Set([config.model, config.fallback_model].filter(Boolean) as string[])];
  const attempts = uniqModels.length ? uniqModels : [config.model];
  const maxPerModel = (config.retries ?? 1) + 1;
  let lastErr = "unknown";

  for (const model of attempts) {
    for (let i = 0; i < maxPerModel; i++) {
      try {
        const r = await call(model);
        let tex = stripFences(r.content).trim();
        tex = tex.replace(/^\uFEFF/, "");
        if (!tex.startsWith("\\documentclass")) {
          lastErr = "missing documentclass";
          continue;
        }
        if (!/\end\{document\}\s*$/s.test(tex)) {
          lastErr = "missing end{document}";
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
        if (i < maxPerModel - 1) {
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
