/**
 * artifact-bundle.ts — Normalized generation payload assembly for job artifacts.
 *
 * Converts sanitized job data, scoring output, judge output, and canonical resume
 * source into stable JSON structures used by resume and cover-letter generators.
 * It also enriches required skills with risk metadata and constrains prompt inputs
 * to smaller, safer subsets.
 *
 * Called by: pipeline stages that prepare resume and cover-letter generation
 * Writes to: nothing
 * Side effects: SHA hashing and risk-map lookups
 */

import * as crypto from "crypto";

import type { Job, Profile } from "@/filter/types";
import type { JudgeResult, JudgeFields, JudgeGap, GapDirective, TechSwap } from "@/judge/types";
import type { ScoreResult } from "@/scorer/types";
import type { CoverLetterInput } from "@/cover-letter/types";
import { lookupJdSkill } from "@/risk-map";
import { applyScopedTechSwaps } from "@/shared/utils";

/**
 * Re-exported slug helpers for artifact folder naming.
 * `makeJobSlug` — builds a stable `{date}_{company}_{role}_{id8}` folder name.
 * `slugify`     — lowercases and kebab-cases a string to a max length.
 */
export { makeJobSlug, slugify } from "./slug";

/**
 * Judge fields persisted into generator inputs and artifact metadata files.
 */
export type ArtifactJudgeJson = {
  /** Judge verdict string, or `null` when judge stage did not produce fields. */
  verdict:     string | null;
  /** Human-readable judge reasoning carried into downstream prompts. */
  reasoning:   string | null;
  /** Concerns the judge wants downstream generators to respect or avoid. */
  concerns:    string[];
  /** Optional judge confidence in 0-1 range when available from model output. */
  confidence?: number | null;
  /** Positive job/profile matches worth reinforcing in generated artifacts. */
  key_matches?: string[];
  /** Gap records that explain missing or weak evidence against job requirements. */
  gaps?:       JudgeGap[];
  /** Actionable gap-handling directives for cover letter or resume tailoring. */
  gap_directives?: GapDirective[];
  /** Optional motivation angle for why the candidate should apply. */
  why_apply?:  string | null;
  /** Structured tailoring hints such as tech swaps from judge output. */
  tailoring_hints?: JudgeFields["tailoring_hints"];
};

export interface ArtifactBundleOk {
  /** Success discriminator for callers narrowing bundle shape. */
  ok: true;
  /** Sanitized job record used as source of truth for generators. */
  job: Job;
  /** Candidate profile that generators may reference directly. */
  profile: Profile;
  /** Canonical LaTeX resume source before any per-job tailoring. */
  canonical_resume_tex: string;
  /** Short SHA derived from canonical resume text for cache identity. */
  canonical_sha: string;
  /** Prompt-safe job JSON plus risk-map enrichment for required skills. */
  jd_json: Record<string, unknown>;
  /** Judge output normalized into nullable, generator-safe fields. */
  judge_json: ArtifactJudgeJson;
  /** Total score plus component breakdown used in prompts and metadata. */
  score: { total: number; components: ScoreResult["components"] };
  /** Verbatim EXPERIENCE slice for cover letter attribution safety. */
  experience_block: string;
}

/**
 * Result of artifact bundle assembly.
 * - `ArtifactBundleOk` — complete payload ready for generation modules
 * - `{ ok: false; reason: string }` — validation failed; caller should skip generation
 */
export type ArtifactBundle = ArtifactBundleOk | {
  /** Failure discriminator for callers narrowing bundle shape. */
  ok: false;
  /** Short machine-readable explanation of why bundle assembly was rejected. */
  reason: string;
};

/**
 * Detects whether judge output carries extended context beyond verdict and reasoning.
 *
 * @param j - Normalized judge payload stored in artifact metadata.
 * @returns `true` when key matches, gaps, directives, or tailoring hints are present.
 */
export function hasExtendedJudgeContext(j: ArtifactJudgeJson): boolean {
  return Boolean(j.key_matches?.length || j.gaps?.length || j.gap_directives?.length || j.tailoring_hints);
}

/**
 * Builds slim job-description JSON for prompt contexts that do not need full job detail.
 *
 * Keeps only high-signal fields plus short skill and responsibility summaries to limit
 * prompt bloat while preserving enough context for resume and cover-letter tailoring.
 *
 * @param jd - Full job-description JSON assembled earlier in pipeline.
 * @returns Reduced job-description object safe for prompt injection.
 */
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

/**
 * Builds slim profile JSON that emphasizes matched and expert skills.
 *
 * Filters profile skills to those that either directly match required job skills or carry
 * expert confidence, then keeps only prompt-relevant profile fields.
 *
 * @param profile - Candidate profile used as source of resume and cover-letter facts.
 * @param jdRequiredNames - Required skill names from job description for matching.
 * @returns Reduced profile object with prompt-safe skill and location context.
 */
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
    work_authorization: profile.work_authorization,
    contact:           profile.contact,
    title:             profile.contact.title,
    location_line:     formatProfileLocationLine(profile),
    target_titles:     profile.target_titles?.slice(0, 4) ?? [],
  };
}

/**
 * Assembles normalized artifact input bundle from job, score, judge, and resume sources.
 *
 * Validates that critical upstream outputs exist before generation begins. On success it
 * computes stable identifiers, enriches required skills with risk-map entries, and packages
 * all downstream inputs into one object.
 *
 * @param args - Upstream pipeline outputs needed to prepare generation inputs.
 * @returns Success bundle for generators, or failure reason when prerequisites are missing.
 */
export function buildArtifactBundle(args: {
  /** Sanitized job payload selected for generation. */
  sanitized: Job;
  /** Score output, required for gating and metadata. */
  scoreResult: ScoreResult | null;
  /** Judge output, optional but normalized when present. */
  judgeResult: JudgeResult | null;
  /** Candidate profile used for prompt assembly. */
  profile: Profile;
  /** Canonical resume LaTeX source used as immutable generation baseline. */
  canonical_resume_tex: string;
  /** Verbatim EXPERIENCE block extracted for attribution-safe cover letters. */
  experience_block: string;
}): ArtifactBundle {
  const { sanitized, scoreResult, judgeResult, profile, canonical_resume_tex, experience_block } = args;

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
    visa_quote:       sanitized.visa_quote,
    location:         sanitized.location,
    meta:             { posted_at: sanitized.meta.posted_at, source_url: sanitized.meta.source_url },
  };

  const required = (sanitized.required_skills ?? []);
  const enriched = required.map(s => ({
    ...s,
    risk_entry: lookupJdSkill(s.name),
  }));
  jd_json.required_skills_with_risk = enriched;

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
    experience_block,
  };
}

/**
 * Normalizes nullable judge output into generator-safe persisted JSON.
 *
 * @param judgeResult - Raw judge result from evaluation stage, or `null` when skipped.
 * @returns Judge fields flattened into nullable metadata structure.
 */
function judgeJsonFromResult(judgeResult: JudgeResult | null): ArtifactJudgeJson {
  const f = judgeResult?.fields;
  if (!f) {
    return { verdict: null, reasoning: null, concerns: [] };
  }
  return {
    verdict:           f.verdict,
    reasoning:         f.reasoning,
    concerns:          f.concerns ?? [],
    confidence:        f.confidence ?? undefined,
    key_matches:       f.key_matches,
    gaps:              f.gaps,
    gap_directives:    f.gap_directives,
    why_apply:         f.why_apply ?? null,
    tailoring_hints: f.tailoring_hints,
  };
}

/**
 * Maps artifact bundle data into cover-letter module input schema.
 *
 * Applies any scoped tech swaps to the EXPERIENCE block so cover-letter generation sees
 * the same terminology adjustments expected elsewhere in the tailored artifact set.
 *
 * @param bundle - Successful artifact bundle produced for a single job.
 * @returns Cover-letter input payload with normalized job, profile, and evidence fields.
 */
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
      visa_quote:       j.visa_quote,
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
      work_authorization: bundle.profile.work_authorization,
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
        ?? bundle.profile.target_titles[0],
      location_line: formatProfileLocationLine(bundle.profile),
    },
    resume:           null,
    experience_block: applyScopedTechSwaps(
      bundle.experience_block,
      bundle.judge_json.tailoring_hints?.tech_swaps as TechSwap[] | undefined,
    ),
    gap_directives:   bundle.judge_json.gap_directives,
    tech_swaps:       bundle.judge_json.tailoring_hints?.tech_swaps as TechSwap[] | undefined,
  };
}

/**
 * Removes URL scheme noise from profile links before prompt or artifact use.
 *
 * @param url - Raw URL string from profile contact metadata.
 * @returns URL without protocol or leading `www.` prefix.
 */
function stripUrlScheme(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
}

/**
 * Formats job location into a compact prompt-safe display line.
 *
 * @param job - Sanitized job whose parsed location fields may include cities and countries.
 * @returns Comma-joined location text, or `null` when no structured location exists.
 */
function formatJobLocationLine(job: Job): string | null {
  const cities = job.location?.cities?.filter(Boolean) ?? [];
  const countries = job.location?.countries?.filter(Boolean) ?? [];
  const parts = [...cities, ...countries];
  return parts.length ? parts.join(", ") : null;
}

/**
 * Formats candidate location plus work-arrangement preference for prompt contexts.
 *
 * Prefers explicit `work_arrangement_note` from profile contact data. When absent, falls
 * back to acceptable location types so prompts still express remote/hybrid/onsite intent.
 *
 * @param profile - Candidate profile with contact and location preference data.
 * @returns Display string combining city, state, and arrangement note or fallback.
 */
export function formatProfileLocationLine(profile: Profile): string {
  const c = profile.contact;
  const note = c.work_arrangement_note?.trim();
  if (note) return `${c.city}, ${c.state}  (${note})`;
  const types = profile.location.acceptable_types ?? [];
  const fallback = types.includes("onsite")
    ? "Open to Onsite"
    : types.includes("hybrid")
    ? "Open to Hybrid"
    : "Open to Remote";
  return `${c.city}, ${c.state}  (${fallback})`;
}

/**
 * Reads requisition ID from mixed-source job metadata keys.
 *
 * Upstream job sources do not agree on casing or naming, so this helper checks the known
 * variants and returns the first non-empty string.
 *
 * @param meta - Job metadata object from sanitized job payload.
 * @returns Normalized requisition ID, or `null` when no usable value exists.
 */
function readReqId(meta: Job["meta"]): string | null {
  const m = meta as unknown as Record<string, unknown>;
  const x = m.req_id ?? m.requisition_id ?? m.requisitionId;
  return typeof x === "string" && x.trim() ? x.trim() : null;
}
