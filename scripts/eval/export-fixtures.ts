/**
 * export-fixtures.ts — Export real jobs from Postgres as frozen eval fixtures.
 *
 * Mirrors the JobArtifactSnapshot shape from src/storage/artifact-load.ts.
 * Fixtures are committed and NEVER regenerated in place; new jobs = new files.
 *
 * Usage: npx tsx scripts/eval/export-fixtures.ts [--limit N]
 * Output: fixtures/eval/jobs/{slug}.json (one file per job)
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import { getPool } from "@/storage/db";

const REPO_ROOT = path.resolve(__dirname, "../..");
const FIXTURES_DIR = path.join(REPO_ROOT, "fixtures", "eval", "jobs");
const CANONICAL_TEX_PATH = path.join(REPO_ROOT, "config", "resume_master.tex");
const DEFAULT_LIMIT = 15;

async function main() {
  const limitArg = process.argv.find(a => a.startsWith("--limit="))?.split("=")[1];
  const limit = limitArg ? parseInt(limitArg, 10) : DEFAULT_LIMIT;

  if (!fs.existsSync(CANONICAL_TEX_PATH)) {
    console.error("canonical resume not found at", CANONICAL_TEX_PATH);
    process.exit(1);
  }
  const canonicalTex = fs.readFileSync(CANONICAL_TEX_PATH, "utf8");
  const canonical_sha = crypto.createHash("sha256").update(canonicalTex, "utf8").digest("hex").slice(0, 16);

  fs.mkdirSync(FIXTURES_DIR, { recursive: true });

  const pool = getPool();

  // Select artifact-eligible jobs: has judge verdict, has gap_directives variety.
  // Priority: jobs with composite/project-targeted target_roles (exercises Track B repair).
  const result = await pool.query(`
    SELECT
      j.job_id, j.run_id, j.title, j.company, j.scraped_at, j.source,
      j.source_url, j.description_raw, j.meta, j.extracted,
      s.total   AS s_total,
      s.skills  AS s_skills, s.semantic AS s_semantic,
      s.yoe     AS s_yoe, s.seniority AS s_seniority, s.location AS s_location,
      jv.verdict AS jv_verdict, jv.bucket AS jv_bucket,
      jv.reasoning AS jv_reasoning, jv.concerns AS jv_concerns,
      jv.model AS jv_model, jv.confidence AS jv_confidence,
      jv.key_matches AS jv_key_matches, jv.gaps AS jv_gaps,
      jv.gap_directives AS jv_gap_directives,
      jv.why_apply AS jv_why_apply,
      jv.tailoring_hints AS jv_tailoring_hints,
      jv.system_prompt_sha AS jv_system_prompt_sha
    FROM jobs j
    JOIN scores s ON s.job_id = j.job_id AND s.run_id = j.run_id
    JOIN judge_verdicts jv ON jv.job_id = j.job_id AND jv.run_id = j.run_id
    WHERE jv.verdict IN ('STRONG', 'MAYBE')
      AND jv.gap_directives IS NOT NULL
    ORDER BY j.scraped_at DESC NULLS LAST
    LIMIT $1
  `, [limit * 2]);  // oversample, then filter

  if (result.rows.length === 0) {
    console.error("No eligible jobs found in DB — have you run the pipeline with JUDGE=1?");
    process.exit(1);
  }

  const rows = result.rows;

  // Score selection criteria from track doc:
  // - at least 3 with composite/project-targeted target_roles
  // - at least 2 with tech_swaps
  // - at least 2 with forbid directives
  // Greedy: take first `limit` rows, report diversity stats.
  const selected = rows.slice(0, limit);

  let written = 0;
  for (const row of selected) {
    const ex = (row.extracted ?? {}) as Record<string, unknown>;
    const meta = (row.meta ?? {}) as Record<string, unknown>;

    const slug = `${row.job_id.slice(0, 8)}_${slugify(row.title)}_${slugify(row.company)}`;

    const gapDirectives = parseJsonField(row.jv_gap_directives);
    const tailoringHints = parseJsonField(row.jv_tailoring_hints);
    const techSwaps = Array.isArray(tailoringHints?.tech_swaps) ? tailoringHints.tech_swaps : [];
    const concerns = parseArrayField(row.jv_concerns);
    const keyMatches = parseArrayField(row.jv_key_matches);
    const gaps = parseJsonField(row.jv_gaps) ?? [];

    const fixture = {
      slug,
      job_id: row.job_id,
      run_id: row.run_id,
      canonical_sha,
      score: {
        total:      Number(row.s_total),
        components: {
          skills:    Number(row.s_skills),
          semantic:  Number(row.s_semantic),
          yoe:       Number(row.s_yoe),
          seniority: Number(row.s_seniority),
          location:  Number(row.s_location),
        },
      },
      bucket: row.jv_bucket ?? "RESULTS",
      // Verbatim judge output — frozen evidence, not cleaned
      judge_json: {
        verdict:          row.jv_verdict ?? null,
        reasoning:        row.jv_reasoning ?? null,
        concerns,
        confidence:       row.jv_confidence != null ? Number(row.jv_confidence) : null,
        key_matches:      keyMatches,
        gaps,
        gap_directives:   gapDirectives ?? [],
        why_apply:        row.jv_why_apply ?? null,
        tailoring_hints:  tailoringHints ?? null,
      },
      // Job facts — sanitized
      job: {
        meta: {
          job_id:         row.job_id,
          schema_version: String(meta.schema_version ?? "1"),
          source_site:    String(meta.source_site ?? row.source ?? "unknown"),
          source_url:     String(meta.source_url ?? row.source_url ?? ""),
          source_score:   typeof meta.source_score === "number" ? meta.source_score : null,
          posted_at:      row.posted_at ? new Date(row.posted_at).toISOString() : null,
          scraped_at:     row.scraped_at ? new Date(row.scraped_at).toISOString() : null,
          run_id:         row.run_id,
          flags:          Array.isArray(meta.flags) ? meta.flags : [],
        },
        title:              row.title ?? "",
        seniority:          String(ex.seniority ?? ""),
        employment_type:    typeof ex.employment_type === "string" ? ex.employment_type : null,
        company: {
          name: row.company ?? "",
          type: String((ex.company as { type?: string } | null)?.type ?? "unknown"),
        },
        location:           (ex.location ?? { type: null, timezone: null, cities: [], countries: [] }),
        compensation:       (ex.compensation ?? { min: null, max: null, currency: null, interval: null }),
        required_skills:    Array.isArray(ex.required_skills) ? ex.required_skills : [],
        years_experience:   (ex.years_experience ?? { min: null, max: null }),
        education_required: (ex.education_required ?? { minimum: "", field: "" }),
        visa_sponsorship:   ex.visa_sponsorship ?? "unmentioned",
        visa_quote:         typeof ex.visa_quote === "string" ? ex.visa_quote : null,
        security_clearance: String(ex.security_clearance ?? ""),
        domain:             typeof ex.domain === "string" ? ex.domain : null,
        responsibilities:   Array.isArray(ex.responsibilities) ? ex.responsibilities : [],
        description_raw:    row.description_raw ?? "",
      },
      // jd_json: slim extracted fields for prompt building (without risk-map enrichment)
      jd_json: {
        title:              row.title ?? "",
        company:            row.company ?? "",
        required_skills:    Array.isArray(ex.required_skills) ? ex.required_skills : [],
        responsibilities:   Array.isArray(ex.responsibilities) ? ex.responsibilities : [],
        years_experience:   (ex.years_experience ?? { min: null, max: null }),
        visa_sponsorship:   ex.visa_sponsorship ?? "unmentioned",
        domain:             typeof ex.domain === "string" ? ex.domain : null,
        required_skills_with_risk: [],  // empty in fixtures — no risk-map at export time
        tech_swaps_from_judge: techSwaps,
      },
    };

    const outPath = path.join(FIXTURES_DIR, `${slug}.json`);
    fs.writeFileSync(outPath, JSON.stringify(fixture, null, 2) + "\n", "utf8");
    written++;
    console.log(`wrote ${outPath}`);
  }

  await pool.end();
  console.log(`\nExported ${written} fixtures to ${FIXTURES_DIR}`);
  console.log(`canonical_sha used: ${canonical_sha}`);

  // Diversity report
  let withCompositeRoles = 0;
  let withTechSwaps = 0;
  let withForbid = 0;
  for (const row of selected) {
    const gds = parseJsonField(row.jv_gap_directives) ?? [];
    const th = parseJsonField(row.jv_tailoring_hints);
    const swaps = Array.isArray(th?.tech_swaps) ? th.tech_swaps : [];
    if (gds.some((d: any) => d.target_role && d.target_role.includes("/"))) withCompositeRoles++;
    if (swaps.length > 0) withTechSwaps++;
    if (gds.some((d: any) => d.handling === "forbid")) withForbid++;
  }
  console.log(`\nDiversity: composite-role=${withCompositeRoles} tech-swaps=${withTechSwaps} forbid=${withForbid}`);
  console.log(`Target: >=3 composite-role, >=2 tech-swaps, >=2 forbid`);
}

function slugify(s: string): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
}

function parseJsonField(value: unknown): any {
  if (value == null) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value as string); } catch { return null; }
}

function parseArrayField(value: unknown): string[] {
  const parsed = parseJsonField(value);
  return Array.isArray(parsed) ? parsed : [];
}

main().catch(e => { console.error(e); process.exit(1); });
