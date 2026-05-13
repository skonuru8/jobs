/**
 * Build the LLM input bundle for resume + cover letter generation.
 */

import * as crypto from "crypto";

import type { Job, Profile } from "@/filter/types";
import type { JudgeResult } from "@/judge/types";
import type { ScoreResult } from "@/scorer/types";
import type { CoverLetterInput } from "@/cover-letter/types";

export { makeJobSlug, slugify } from "./slug";

export interface ArtifactBundleOk {
  ok: true;
  job: Job;
  profile: Profile;
  canonical_resume_tex: string;
  canonical_sha: string;
  jd_json: Record<string, unknown>;
  judge_json: {
    verdict: string | null;
    reasoning: string | null;
    concerns: string[];
  };
  score: { total: number; components: ScoreResult["components"] };
}

export type ArtifactBundle = ArtifactBundleOk | { ok: false; reason: string };

export function buildArtifactBundle(args: {
  sanitized: Job;
  scoreResult: ScoreResult | null;
  judgeResult: JudgeResult | null;
  profile: Profile;
  canonical_resume_tex: string;
}): ArtifactBundle {
  const { sanitized, scoreResult, judgeResult, profile, canonical_resume_tex } = args;

  if (!canonical_resume_tex.trim()) {
    return { ok: false, reason: "canonical resume empty" };
  }
  if (!scoreResult) {
    return { ok: false, reason: "score missing" };
  }
  if (!sanitized.meta?.job_id) {
    return { ok: false, reason: "job_id missing in sanitized.meta" };
  }

  const canonical_sha = crypto
    .createHash("sha256")
    .update(canonical_resume_tex, "utf8")
    .digest("hex")
    .slice(0, 12);

  const jd_json: Record<string, unknown> = {
    title:            sanitized.title,
    company:          sanitized.company?.name ?? "",
    domain:           sanitized.domain,
    employment_type:  sanitized.employment_type,
    seniority:        sanitized.seniority,
    required_skills:  sanitized.required_skills,
    responsibilities: sanitized.responsibilities,
    years_experience: sanitized.years_experience,
    education_required: sanitized.education_required,
    visa_sponsorship: sanitized.visa_sponsorship,
    location:         sanitized.location,
    meta:             { posted_at: sanitized.meta.posted_at, source_url: sanitized.meta.source_url },
  };

  const judge_json = {
    verdict:   judgeResult?.verdict ?? null,
    reasoning: judgeResult?.fields?.reasoning ?? null,
    concerns:  judgeResult?.fields?.concerns ?? [],
  };

  return {
    ok: true,
    job: sanitized,
    profile,
    canonical_resume_tex,
    canonical_sha,
    jd_json,
    judge_json,
    score: { total: scoreResult.score, components: scoreResult.components },
  };
}

/** Map bundle → cover letter module input (canonical resume = full TeX). */
export function coverLetterInputFromBundle(bundle: ArtifactBundleOk): CoverLetterInput {
  const j = bundle.job;
  const meta = j.meta;
  const req = (name: string, imp: string, yr: number | null) => ({
    name,
    importance: imp,
    years_required: yr,
  });
  return {
    job: {
      job_id:           meta.job_id,
      title:            j.title ?? "",
      company:          j.company?.name ?? "",
      domain:           j.domain,
      employment_type:  j.employment_type,
      required_skills:  (j.required_skills ?? []).map(s =>
        req(s.name, s.importance, s.years_required)),
      responsibilities: j.responsibilities ?? [],
      yoe_min:          j.years_experience?.min ?? null,
      yoe_max:          j.years_experience?.max ?? null,
      visa_sponsorship: j.visa_sponsorship,
      score:            bundle.score.total,
      score_components: bundle.score.components,
      judge_reasoning:  bundle.judge_json.reasoning,
      judge_concerns:   bundle.judge_json.concerns,
      location_line:    formatJobLocationLine(j),
      req_id:           readReqId(meta),
    },
    profile: {
      skills:            bundle.profile.skills.map(s => ({
        name: s.name,
        years: s.years,
        confidence: s.confidence as "expert" | "strong" | "familiar",
        category: s.category,
      })),
      years_experience:  bundle.profile.years_experience,
      education:         bundle.profile.education,
      preferred_domains: bundle.profile.preferred_domains,
      contact:           {
        name:     bundle.profile.contact.name,
        email:    bundle.profile.contact.email,
        phone:    bundle.profile.contact.phone,
        linkedin: stripUrlScheme(bundle.profile.contact.linkedin),
        github:   stripUrlScheme(bundle.profile.contact.github),
        city:     bundle.profile.contact.city,
        state:    bundle.profile.contact.state,
      },
      title:
        bundle.profile.contact.title?.trim()
        ?? bundle.profile.target_titles?.[0]
        ?? "Senior Software Engineer",
      location_line: formatProfileLocationLine(bundle.profile),
    },
    resume: bundle.canonical_resume_tex,
  };
}

function stripUrlScheme(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
}

function formatJobLocationLine(job: Job): string | null {
  const cities = job.location?.cities?.filter(Boolean) ?? [];
  const countries = job.location?.countries?.filter(Boolean) ?? [];
  const parts = [...cities, ...countries];
  return parts.length ? parts.join(", ") : null;
}

function formatProfileLocationLine(profile: Profile): string {
  const c = profile.contact;
  const note = c.work_arrangement_note?.trim();
  if (note) return `${c.city}, ${c.state} \\quad (${note})`;
  const types = profile.location.acceptable_types?.join(" / ") ?? "Remote";
  return `${c.city}, ${c.state} \\quad (${types})`;
}

function readReqId(meta: Job["meta"]): string | null {
  const m = meta as unknown as Record<string, unknown>;
  const x = m.req_id ?? m.requisition_id ?? m.requisitionId;
  return typeof x === "string" && x.trim() ? x.trim() : null;
}
