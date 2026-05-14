// scripts/verify-total-mode.ts
import * as fs from "fs";
import * as path from "path";
import { loadRiskMap, lookupJdSkill } from "../src/risk-map/index.js";

const REPO_ROOT = process.cwd();
const APPS_DIR = path.join(REPO_ROOT, "output", "applications");
const CANONICAL_LOWER = fs.readFileSync(
  path.join(REPO_ROOT, "config", "resume_master.tex"),
  "utf8",
).toLowerCase();

loadRiskMap(REPO_ROOT);

function tailoredCovers(tailoredLower: string, gap: string): { covered: boolean; via?: string } {
  if (tailoredLower.includes(gap.toLowerCase())) {
    return { covered: true, via: gap };
  }
  const entry = lookupJdSkill(gap);
  if (!entry) return { covered: false };
  if (tailoredLower.includes(entry.candidate_source_skill.toLowerCase())) {
    return { covered: true, via: `${entry.candidate_source_skill} (${entry.relationship})` };
  }
  return { covered: false };
}

function appearanceDetail(tailoredLower: string, gap: string): string {
  const r = tailoredCovers(tailoredLower, gap);
  return r.via && r.via !== gap ? `${gap} → via "${r.via}"` : gap;
}

// ---------------------------------------------------------------------------
// Report type
// ---------------------------------------------------------------------------
interface Report {
  run_folder:           string;
  job_slug:             string;
  tailored_lower:       string;
  judge_gaps:           Array<{ requirement: string; severity: string }>;
  judge_confidence:     number | null;
  jd_required_skills:   string[];
  canonical_has:        string[];
  canonical_missing:    string[];
  appeared_in_tailored: string[];
  still_missing:        string[];
  diagnostics:          string[];
}

const reports: Report[] = [];

// ---------------------------------------------------------------------------
// Two-level walk: run folder → slug folder
// ---------------------------------------------------------------------------
for (const runFolder of fs.readdirSync(APPS_DIR)) {
  const runDir = path.join(APPS_DIR, runFolder);
  if (!fs.statSync(runDir).isDirectory()) continue;

  for (const slug of fs.readdirSync(runDir)) {
    const dir = path.join(runDir, slug);
    if (!fs.statSync(dir).isDirectory()) continue;

    const metaPath   = path.join(dir, "meta.json");
    const resumePath = path.join(dir, "resume.tex");
    const jdPath     = path.join(dir, "job_description.md");
    if (!fs.existsSync(metaPath) || !fs.existsSync(resumePath)) continue;

    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    const tailoredLow = fs.readFileSync(resumePath, "utf8").toLowerCase();
    const jdMd = fs.existsSync(jdPath) ? fs.readFileSync(jdPath, "utf8") : "";

    const diagnostics: string[] = [];

    // (1) Judge gaps
    const judgeGaps = meta?.judge?.gaps ?? [];
    if (judgeGaps.length === 0) {
      diagnostics.push("⚠ judge reported zero gaps");
    }

    // (2) JD required_skills from job_description.md
    const jdRequired: string[] = [];
    const reqMatch = jdMd.match(/##\s*Required Skills\s*\n([\s\S]*?)(?=\n##|\n#|$)/i);
    if (reqMatch) {
      for (const line of reqMatch[1].split("\n")) {
        const m = line.match(/^[\-\*]\s*\*?\*?([A-Za-z0-9][A-Za-z0-9 \.\+/#\-]*?)(?:\s*\*\*)?\s*(?:\(|$)/);
        if (m && m[1].trim()) jdRequired.push(m[1].trim().toLowerCase());
      }
    }
    if (jdRequired.length === 0) {
      diagnostics.push("⚠ no required skills parsed from job_description.md");
    }

    // (3) Canonical has vs missing
    const canonicalHas     = jdRequired.filter(s => canonicalContains(CANONICAL_LOWER, s));
    const canonicalMissing = jdRequired.filter(s => !canonicalContains(CANONICAL_LOWER, s));

    // (4) Of the missing, what appeared in tailored (with risk-map matching)?
    const appeared     = canonicalMissing.filter(s => tailoredCovers(tailoredLow, s).covered);
    const stillMissing = canonicalMissing.filter(s => !tailoredCovers(tailoredLow, s).covered);

    reports.push({
      run_folder:           runFolder,
      job_slug:             slug,
      tailored_lower:       tailoredLow,
      judge_gaps:           judgeGaps.map((g: any) => ({ requirement: g.requirement, severity: g.severity })),
      judge_confidence:     meta?.judge?.confidence ?? null,
      jd_required_skills:   jdRequired,
      canonical_has:        canonicalHas,
      canonical_missing:    canonicalMissing,
      appeared_in_tailored: appeared,
      still_missing:        stillMissing,
      diagnostics,
    });
  }
}

function canonicalContains(canonical: string, skill: string): boolean {
  const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pat = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i");
  return pat.test(canonical);
}

// ---------------------------------------------------------------------------
// Output — per-run-folder breakdown, then aggregate
// ---------------------------------------------------------------------------
console.log(`\nAnalyzed ${reports.length} job folders.\n`);

const byRun = new Map<string, Report[]>();
for (const r of reports) {
  const arr = byRun.get(r.run_folder) ?? [];
  arr.push(r);
  byRun.set(r.run_folder, arr);
}

let jobsWithJudgeGaps    = 0;
let jobsWithComputedGaps = 0;
let totalComputedGaps    = 0;
let totalAppeared        = 0;

for (const [runFolder, runReports] of byRun) {
  console.log(`\n════════════ Run: ${runFolder} (${runReports.length} job(s)) ════════════`);

  for (const r of runReports) {
    const appearedLabels = r.appeared_in_tailored.map(s => appearanceDetail(r.tailored_lower, s));

    console.log(`──────────────────────────────────────────────`);
    console.log(`${r.job_slug}`);
    console.log(`  Judge confidence: ${r.judge_confidence ?? "(missing)"}`);
    console.log(`  JD required: [${r.jd_required_skills.join(", ") || "(empty)"}]`);
    console.log(`  Canonical missing from JD list: [${r.canonical_missing.join(", ") || "(none)"}]`);
    console.log(`  Judge.gaps[]: [${r.judge_gaps.map(g => `${g.requirement}(${g.severity})`).join(", ") || "(empty)"}]`);
    console.log(`  Appeared in tailored: [${appearedLabels.join(", ") || "(none)"}]`);
    console.log(`  Still missing in tailored: [${r.still_missing.join(", ") || "(none)"}]`);
    if (r.diagnostics.length) console.log(`  ⚠ ${r.diagnostics.join("; ")}`);
    if (r.canonical_missing.length > 0) {
      const score = r.appeared_in_tailored.length / r.canonical_missing.length;
      console.log(`  TOTAL MODE SCORE: ${(score * 100).toFixed(0)}%`);
    } else {
      console.log(`  TOTAL MODE SCORE: N/A (no computed gaps to test)`);
    }

    if (r.judge_gaps.length > 0) jobsWithJudgeGaps++;
    if (r.canonical_missing.length > 0) {
      jobsWithComputedGaps++;
      totalComputedGaps += r.canonical_missing.length;
      totalAppeared     += r.appeared_in_tailored.length;
    }
  }
}

console.log(`\n══════════ AGGREGATE ══════════`);
console.log(`Jobs with ANY judge.gaps[] reported:  ${jobsWithJudgeGaps}/${reports.length}`);
console.log(`Jobs with computed gaps (JD - canonical): ${jobsWithComputedGaps}/${reports.length}`);
if (totalComputedGaps > 0) {
  console.log(`Total computed gaps across all jobs:  ${totalComputedGaps}`);
  console.log(`Total covered by tailored resume:     ${totalAppeared}`);
  console.log(`Overall total-mode coverage:          ${(100 * totalAppeared / totalComputedGaps).toFixed(0)}%`);
} else {
  console.log(`No computed gaps found — total-mode behavior was not actually exercised on this batch.`);
  console.log(`This likely means:`);
  console.log(`  (a) all jobs are perfect Java/Spring fits — common for cynet/bcforward/staffing posts`);
  console.log(`  (b) job_description.md parser is missing skills it should pick up`);
  console.log(`  (c) JDs themselves listed only generic skills that all overlap with canonical`);
}
