/**
 * Load latest DB snapshot for a job_id to rebuild pipeline artifact inputs.
 */

import type { Job, JobMeta, JobLocation } from "@/filter/types";
import type { JudgeResult, JudgeVerdict, JudgeFields } from "@/judge/types";
import type { ScoreResult } from "@/scorer/types";
import { DEFAULT_THRESHOLD, DEFAULT_WEIGHTS } from "@/scorer/score";

import { getPool } from "./db.js";
import { formatErr } from "./persist.js";

export interface JobArtifactSnapshot {
  job: Job;
  scoreResult: ScoreResult;
  judgeResult: JudgeResult;
  run_id: string;
  bucket: string;
}

export async function fetchLatestJobSnapshotForArtifacts(
  jobId: string,
): Promise<JobArtifactSnapshot | null> {
  try {
    const result = await getPool().query(
      `SELECT j.job_id, j.run_id, j.title, j.company, j.posted_at, j.scraped_at,
              j.source, j.source_url, j.description_raw, j.meta, j.extracted,
              s.total AS s_total, s.skills AS s_skills, s.semantic AS s_semantic,
              s.yoe AS s_yoe, s.seniority AS s_seniority, s.location AS s_location,
              jv.verdict AS jv_verdict, jv.bucket AS jv_bucket, jv.reasoning AS jv_reasoning,
              jv.concerns AS jv_concerns,
              jv.model AS jv_model,
              jv.confidence AS jv_confidence,
              jv.key_matches AS jv_key_matches,
              jv.gaps AS jv_gaps,
              jv.why_apply AS jv_why_apply,
              jv.tailoring_hints AS jv_tailoring_hints,
              jv.system_prompt_sha AS jv_system_prompt_sha
         FROM jobs j
         JOIN scores s ON s.job_id = j.job_id AND s.run_id = j.run_id
         JOIN judge_verdicts jv ON jv.job_id = j.job_id AND jv.run_id = j.run_id
        WHERE j.job_id = $1
        ORDER BY j.scraped_at DESC NULLS LAST
        LIMIT 1`,
      [jobId],
    );
    const row = result.rows[0];
    if (!row) return null;

    const ex = (row.extracted ?? {}) as Record<string, unknown>;
    const meta = (row.meta ?? {}) as Record<string, unknown>;

    const jobMeta: JobMeta = {
      job_id:         row.job_id,
      schema_version: String(meta.schema_version ?? "1"),
      source_site:    String(meta.source_site ?? row.source ?? "unknown"),
      source_url:     String(meta.source_url ?? row.source_url ?? ""),
      source_score:   typeof meta.source_score === "number" ? meta.source_score : null,
      posted_at:      row.posted_at ? new Date(row.posted_at).toISOString() : null,
      scraped_at:     row.scraped_at ? new Date(row.scraped_at).toISOString() : new Date().toISOString(),
      run_id:         row.run_id,
      flags:          Array.isArray(meta.flags) ? (meta.flags as string[]) : [],
    };

    const loc = (ex.location ?? {}) as Record<string, unknown>;
    const jobLocation: JobLocation = {
      type:      typeof loc.type === "string" ? loc.type : null,
      timezone:  typeof loc.timezone === "string" ? loc.timezone : null,
      cities:    Array.isArray(loc.cities) ? (loc.cities as string[]) : [],
      countries: Array.isArray(loc.countries) ? (loc.countries as string[]) : [],
    };

    const comp = (ex.compensation ?? {}) as Record<string, unknown>;
    const compensation: Job["compensation"] = {
      min:      typeof comp.min === "number" ? comp.min : null,
      max:      typeof comp.max === "number" ? comp.max : null,
      currency: typeof comp.currency === "string" ? comp.currency : null,
      interval: typeof comp.interval === "string" ? comp.interval : null,
    };

    const job: Job = {
      meta:               jobMeta,
      title:              row.title ?? "",
      seniority:          String(ex.seniority ?? ""),
      employment_type:  typeof ex.employment_type === "string" ? ex.employment_type : null,
      company:            { name: row.company ?? "", type: String((ex.company as { type?: string } | undefined)?.type ?? "unknown") },
      location:           jobLocation,
      compensation,
      required_skills:    Array.isArray(ex.required_skills) ? (ex.required_skills as Job["required_skills"]) : [],
      years_experience:   (ex.years_experience ?? { min: null, max: null }) as Job["years_experience"],
      education_required: (ex.education_required ?? { minimum: "", field: "" }) as Job["education_required"],
      visa_sponsorship:   typeof ex.visa_sponsorship === "boolean" ? ex.visa_sponsorship : null,
      security_clearance: String(ex.security_clearance ?? ""),
      domain:             typeof ex.domain === "string" ? ex.domain : null,
      responsibilities:   Array.isArray(ex.responsibilities) ? (ex.responsibilities as string[]) : [],
      description_raw:    row.description_raw ?? "",
    };

    const total = Number(row.s_total);
    const scoreResult: ScoreResult = {
      score:         total,
      gate_passed:   total >= DEFAULT_THRESHOLD,
      components: {
        skills:    Number(row.s_skills),
        semantic:  Number(row.s_semantic),
        yoe:       Number(row.s_yoe),
        seniority: Number(row.s_seniority),
        location:  Number(row.s_location),
      },
      weights:     DEFAULT_WEIGHTS,
      threshold:   DEFAULT_THRESHOLD,
    };

    const concernsRaw = row.jv_concerns;
    const concerns = Array.isArray(concernsRaw)
      ? (concernsRaw as string[])
      : typeof concernsRaw === "string"
      ? (JSON.parse(concernsRaw) as string[])
      : [];

    const verdict = (row.jv_verdict ?? null) as JudgeVerdict | null;
    const fields: JudgeFields | null = verdict
      ? {
          verdict,
          reasoning: row.jv_reasoning ?? "",
          concerns,
          confidence: row.jv_confidence != null ? Number(row.jv_confidence) : undefined,
          key_matches: Array.isArray(row.jv_key_matches) ? (row.jv_key_matches as string[]) : undefined,
          gaps: Array.isArray(row.jv_gaps) ? (row.jv_gaps as JudgeFields["gaps"]) : undefined,
          why_apply: row.jv_why_apply ?? undefined,
          tailoring_hints:
            row.jv_tailoring_hints && typeof row.jv_tailoring_hints === "object"
              ? (row.jv_tailoring_hints as JudgeFields["tailoring_hints"])
              : undefined,
        }
      : null;

    const judgeResult: JudgeResult = {
      status:              "ok",
      verdict,
      fields,
      model:                 row.jv_model ?? "",
      prompt_version:        "v3",
      system_prompt_sha:     row.jv_system_prompt_sha ?? undefined,
      judged_at:             new Date().toISOString(),
    };

    return { job, scoreResult, judgeResult, run_id: row.run_id, bucket: row.jv_bucket ?? "RESULTS" };
  } catch (e) {
    console.error("[storage] fetchLatestJobSnapshotForArtifacts:", formatErr(e));
    return null;
  }
}
