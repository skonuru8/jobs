/**
 * Build the LLM input bundle for resume + cover letter generation.
 */

import * as crypto from "crypto";

import type { Job, Profile } from "@/filter/types";
import type { JudgeResult, JudgeFields, JudgeGap } from "@/judge/types";
import type { ScoreResult } from "@/scorer/types";
import type { CoverLetterInput } from "@/cover-letter/types";
import type { ResumeBrief } from "@/cover-letter/resume-brief";

export { makeJobSlug, slugify } from "./slug";

/** Judge fields persisted for generators + job_description.md */
export type ArtifactJudgeJson = {
  verdict:     string | null;
  reasoning:   string | null;
  concerns:    string[];
  confidence?: number;
  key_matches?: string[];
  gaps?:       JudgeGap[];
  why_apply?:  string | null;
  tailoring_hints?: JudgeFields["tailoring_hints"];
};

export interface ArtifactBundleOk {
  ok: true;
  job: Job;
  profile: Profile;
  canonical_resume_tex: string;
  canonical_sha: string;
  jd_json: Record<string, unknown>;
  judge_json: ArtifactJudgeJson;
  score: { total: number; components: ScoreResult["components"] };
  /** Structured resume summary for cover letter LLM (token savings). */
  resume_brief: ResumeBrief;
}

export type ArtifactBundle = ArtifactBundleOk | { ok: false; reason: string };

export function hasExtendedJudgeContext(j: ArtifactJudgeJson): boolean {
  return Boolean(j.key_matches?.length || j.gaps?.length || j.tailoring_hints);
}

export function buildSlimJdForPrompts(jd: Record<string, unknown>): Record<string, unknown> {
  const skills = (jd.required_skills as Array<{ name?: string }> | undefined) ?? [];
  const resp = (jd.responsibilities as string[] | undefined) ?? [];
  return {
    title:                     jd.title,
    company:                   jd.company,
    domain:                    jd.domain,
    required_skills_summary:   skills.map(s => s.name ?? "").filter(Boolean).join(", "),
    responsibilities_summary: resp.slice(0, 3).join("; "),
  };
}

export function buildSlimProfileForPrompts(profile: Profile, jdRequiredNames: string[]): Record<string, unknown> {
  const requiredSet = new Set(jdRequiredNames.map(s => s.toLowerCase()));
  const relevant = profile.skills.filter(s =>
    requiredSet.has(s.name.toLowerCase()) || s.confidence === "expert",
  );
  return {
    skills:            relevant.slice(0, 25),
    years_experience:  profile.years_experience,
    education:         profile.education,
    preferred_domains: profile.preferred_domains,
    contact:           profile.contact,
    title:             profile.contact.title,
    location_line:     formatProfileLocationLine(profile),
    target_titles:     profile.target_titles?.slice(0, 4) ?? [],
  };
}

export function buildArtifactBundle(args: {
  sanitized: Job;
  scoreResult: ScoreResult | null;
  judgeResult: JudgeResult | null;
  profile: Profile;
  canonical_resume_tex: string;
  resume_brief: ResumeBrief;
}): ArtifactBundle {
  const { sanitized, scoreResult, judgeResult, profile, canonical_resume_tex, resume_brief } = args;

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

  const judge_json = judgeJsonFromResult(judgeResult);

  return {
    ok: true,
    job: sanitized,
    profile,
    canonical_resume_tex,
    canonical_sha,
    jd_json,
    judge_json,
    score: { total: scoreResult.score, components: scoreResult.components },
    resume_brief,
  };
}

function judgeJsonFromResult(judgeResult: JudgeResult | null): ArtifactJudgeJson {
  const f = judgeResult?.fields;
  if (!f) {
    return { verdict: null, reasoning: null, concerns: [] };
  }
  return {
    verdict:           f.verdict,
    reasoning:         f.reasoning,
    concerns:          f.concerns ?? [],
    confidence:        f.confidence,
    key_matches:       f.key_matches,
    gaps:              f.gaps,
    why_apply:         f.why_apply ?? null,
    tailoring_hints: f.tailoring_hints,
  };
}

/** Map bundle → cover letter module input. */
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
    resume:        null,
    resume_brief:  bundle.resume_brief,
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

export function formatProfileLocationLine(profile: Profile): string {
  const c = profile.contact;
  const note = c.work_arrangement_note?.trim();
  if (note) return `${c.city}, ${c.state} \\quad (${note})`;
  const types = profile.location.acceptable_types ?? [];
  const fallback = types.includes("onsite")
    ? "Open to Onsite"
    : types.includes("hybrid")
    ? "Open to Hybrid"
    : "Open to Remote";
  return `${c.city}, ${c.state} \\quad (${fallback})`;
}

function readReqId(meta: Job["meta"]): string | null {
  const m = meta as unknown as Record<string, unknown>;
  const x = m.req_id ?? m.requisition_id ?? m.requisitionId;
  return typeof x === "string" && x.trim() ? x.trim() : null;
}
