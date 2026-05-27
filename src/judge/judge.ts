/**
 * judge.ts — LLM judge stage. Bible §5 stages 13–14.
 */

import { complete, ReasoningConfig } from "./client";
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
import type { Profile } from "@/filter/types";

export interface JudgeConfig {
  model:       string;
  max_tokens:  number;
  temperature: number;
  throttle_ms: number;
  reasoning?:  ReasoningConfig;
}

function defaultProfileForJudge(): Profile {
  return {
    meta: {
      profile_id: "fallback",
      schema_version: "1.0.0",
      version: "1",
      last_updated: new Date().toISOString(),
    },
    target_titles:       ["Senior Software Engineer"],
    acceptable_seniority: ["senior"],
    acceptable_employment: ["full_time"],
    location: {
      current_city: "Unknown",
      current_country: "USA",
      timezone: "America/New_York",
      acceptable_types: ["remote", "hybrid", "onsite"],
      acceptable_cities: [],
      acceptable_countries: ["USA"],
      willing_to_relocate: false,
    },
    compensation: { min_acceptable: 0, currency: "USD", interval: "annual" },
    contact: {
      name: "Candidate", email: "x@y.z", phone: "", linkedin: "", github: "",
      city: "", state: "",
    },
    skills: [],
    years_experience: 0,
    education: { degree: "bachelor", field: "Computer Science" },
    work_authorization: {
      requires_sponsorship: false,
      visa_type: "",
      clearance_eligible: true,
      cover_letter_phrasing_sponsorship_needed: "",
      cover_letter_phrasing_no_sponsorship_needed: "",
    },
    preferred_domains: [],
    deal_breakers: [],
  };
}

export async function judge(
  input:  JudgeInput,
  config: JudgeConfig,
): Promise<JudgeResult> {
  const judged_at  = new Date().toISOString();
  const userPrompt = buildJudgePrompt(input);
  const profile = input.profile ?? defaultProfileForJudge();
  const systemPrompt = buildSystemPrompt(profile, input.roles_list, input.canonical_skills);
  const systemPromptSha = computeSystemPromptSha(systemPrompt);

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const,   content: userPrompt },
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
  try {
    ({ content: raw, model } = await _withHttpRetry(call));
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

  let validation = validateJudge(raw);

  if (!validation.ok) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      ({ content: raw, model } = await _withHttpRetry(call));
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
    validation = validateJudge(raw);
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
  };
}

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

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "unknown";
}

async function _withHttpRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    await new Promise(r => setTimeout(r, 2000));
    return await fn();
  }
}

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
