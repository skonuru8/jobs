import * as fs from "fs";
import * as path from "path";

const RUN_FOLDERS = [
  "2026-05-27T05-27-51_98a1eb2c",
  "2026-05-26T14-57-59_3add4764",
  "2026-05-26T06-07-10_51392dc6",
  "2026-05-26T05-49-05_1ccc7d92",
];

const BANNED_STYLE =
  /demonstrating transferable|analogous to|akin to|whose syntax (?:and|or) features|foundational knowledge of|directly applicable to|translate[s]? directly to|immediately useful in|comparable to|while not having direct|with limited .* exposure|similar to <JD tech>/i;
const DASHES = /---|--|[\u2013\u2014]/;

interface ArtifactAudit {
  run_folder: string;
  job_folder: string;
  job_title: string;
  company: string;
  better_than_original: "yes" | "no" | "partial";
  why_better: string[];
  risk_issues: string[];
  fix_category: string[];
  resume?: {
    word_count: number;
    jd_skill_hits: string[];
    baseline_skill_hits: string[];
    gained_skill_hits: string[];
    dropped_canonical_bullets: number;
    added_or_modified_claims: number;
    skills_section_equal: boolean;
    style_hits: number;
    dash_hits: number;
    fabricated_role_attribution: number;
  };
  cover_letter?: {
    word_count: number;
    truncated: boolean;
    style_hits: number;
    dash_hits: number;
    unsafe_visa_wording: boolean;
    stack_mismatch_signals: string[];
  };
}

interface AuditReport {
  generated_at: string;
  baseline_resume: string;
  runs: string[];
  totals: Record<string, number>;
  jobs: ArtifactAudit[];
  synthesis: Array<{ pattern: string; count: number; fix: string }>;
}

function main(): void {
  const repoRoot = process.cwd();
  const baselinePath = path.join(repoRoot, "config", "resume_master.tex");
  const baseline = fs.readFileSync(baselinePath, "utf8");
  const baselineSkills = extractSkillsBlock(baseline);
  const baselineBullets = extractItems(baseline);

  const jobs: ArtifactAudit[] = [];
  for (const run of RUN_FOLDERS) {
    const runDir = path.join(repoRoot, "output", "applications", run);
    if (!fs.existsSync(runDir)) continue;
    for (const entry of fs.readdirSync(runDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const jobDir = path.join(runDir, entry.name);
      const meta = readJson(path.join(jobDir, "meta.json"));
      const jdText = readText(path.join(jobDir, "job_description.md"));
      const resumeTex = readText(path.join(jobDir, "resume.tex"));
      const coverTex = readText(path.join(jobDir, "cover_letter.tex"));
      if (!resumeTex && !coverTex) continue;

      const jdSkills = extractRequiredSkills(jdText);
      const baselineHits = skillHits(baseline, jdSkills);
      const resumeHits = skillHits(resumeTex, jdSkills);
      const gained = resumeHits.filter(s => !baselineHits.includes(s));
      const droppedBullets = baselineBullets.filter(b => !resumeTex.includes(b)).length;
      const generatedBullets = extractItems(resumeTex);
      const addedClaims = generatedBullets.filter(b => !baselineBullets.includes(b)).length;
      const resumeSkills = extractSkillsBlock(resumeTex);
      const resumeStyleHits = countMatches(resumeTex, BANNED_STYLE);
      const coverStyleHits = countMatches(coverTex, BANNED_STYLE);
      const resumeDashHits = countMatches(resumeTex, DASHES);
      const coverDashHits = countMatches(coverTex, DASHES);
      const coverBody = extractCoverBody(coverTex);
      const coverWords = countWords(coverBody);
      const truncated = Boolean(coverTex) && looksTruncated(coverBody);
      const fabCount = Number(meta?.resume?.risk_summary?.counts?.fabricated_role_attribution ?? 0);
      const stackMismatches = detectStackMismatches(resumeTex, coverTex, meta);

      const riskIssues: string[] = [];
      const fixCategories = new Set<string>();
      if (resumeStyleHits || coverStyleHits) {
        riskIssues.push("banned tailoring/style phrase present");
        fixCategories.add("prompt rule");
      }
      if (resumeDashHits || coverDashHits) {
        riskIssues.push("em/en dash form present");
        fixCategories.add("prompt rule");
      }
      if (truncated || (coverTex && coverWords < 350)) {
        riskIssues.push("cover letter appears truncated or under length");
        fixCategories.add("validator/schema");
      }
      if (resumeTex && normalizeBlock(resumeSkills) !== normalizeBlock(baselineSkills)) {
        riskIssues.push("SKILLS section differs from canonical");
        fixCategories.add("prompt rule");
      }
      if (stackMismatches.length) {
        riskIssues.push("cover letter stack narration may disagree with tailored resume");
        fixCategories.add("prompt rule");
      }
      if (fabCount > 3) {
        riskIssues.push(`fabricated role-attribution count is ${fabCount}`);
        fixCategories.add("audit flag");
      }
      if (addedClaims > 8) {
        riskIssues.push(`${addedClaims} generated bullets differ from canonical evidence`);
        fixCategories.add("audit flag");
      }
      if (resumeHits.length === 0 && jdSkills.length > 0) {
        riskIssues.push("no extracted JD skill hits found in resume");
        fixCategories.add("extractor recall");
      }

      const whyBetter: string[] = [];
      if (gained.length) whyBetter.push(`adds JD skill emphasis: ${gained.slice(0, 8).join(", ")}`);
      if (resumeHits.length > baselineHits.length) {
        whyBetter.push(`JD skill coverage improves from ${baselineHits.length} to ${resumeHits.length}`);
      }
      if (coverTex && coverWords >= 350 && !truncated) {
        whyBetter.push("cover letter supplies job-specific narrative at acceptable length");
      }
      if (!whyBetter.length) whyBetter.push("no clear measurable improvement over baseline detected");

      const better =
        riskIssues.length === 0 && resumeHits.length > baselineHits.length ? "yes" :
        resumeHits.length >= baselineHits.length && whyBetter[0] !== "no clear measurable improvement over baseline detected" ? "partial" :
        "no";

      jobs.push({
        run_folder: run,
        job_folder: entry.name,
        job_title: String(meta?.job_meta?.title ?? extractTitle(jdText) ?? entry.name),
        company: String(meta?.job_meta?.company ?? "unknown"),
        better_than_original: better,
        why_better: whyBetter,
        risk_issues: riskIssues,
        fix_category: Array.from(fixCategories),
        resume: resumeTex ? {
          word_count: countWords(stripLatex(resumeTex)),
          jd_skill_hits: resumeHits,
          baseline_skill_hits: baselineHits,
          gained_skill_hits: gained,
          dropped_canonical_bullets: droppedBullets,
          added_or_modified_claims: addedClaims,
          skills_section_equal: normalizeBlock(resumeSkills) === normalizeBlock(baselineSkills),
          style_hits: resumeStyleHits,
          dash_hits: resumeDashHits,
          fabricated_role_attribution: fabCount,
        } : undefined,
        cover_letter: coverTex ? {
          word_count: coverWords,
          truncated,
          style_hits: coverStyleHits,
          dash_hits: coverDashHits,
          unsafe_visa_wording: unsafeVisaWording(coverBody),
          stack_mismatch_signals: stackMismatches,
        } : undefined,
      });
    }
  }

  const report: AuditReport = {
    generated_at: new Date().toISOString(),
    baseline_resume: "config/resume_master.tex",
    runs: RUN_FOLDERS,
    totals: {
      jobs: jobs.length,
      resumes: jobs.filter(j => j.resume).length,
      cover_letters: jobs.filter(j => j.cover_letter).length,
      better_yes: jobs.filter(j => j.better_than_original === "yes").length,
      better_partial: jobs.filter(j => j.better_than_original === "partial").length,
      better_no: jobs.filter(j => j.better_than_original === "no").length,
      style_issues: jobs.filter(j => j.risk_issues.some(r => r.includes("style"))).length,
      dash_issues: jobs.filter(j => j.risk_issues.some(r => r.includes("dash"))).length,
      truncated_covers: jobs.filter(j => j.cover_letter?.truncated).length,
      skills_pollution: jobs.filter(j => j.resume && !j.resume.skills_section_equal).length,
      employer_stack_mismatch: jobs.filter(j => j.cover_letter?.stack_mismatch_signals.length).length,
      attribution_overrun: jobs.filter(j => (j.resume?.fabricated_role_attribution ?? 0) > 3).length,
    },
    jobs,
    synthesis: synthesize(jobs),
  };

  const outDir = path.join(repoRoot, "output", "audits");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "round2_artifact_quality_baseline.json"), JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(path.join(outDir, "round2_artifact_quality_baseline.md"), renderMarkdown(report));
  console.log(JSON.stringify(report.totals, null, 2));
}

function readText(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function readJson(file: string): any {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function extractRequiredSkills(jd: string): string[] {
  const m = jd.match(/## Required Skills\n([\s\S]*?)(?:\n## |\n# |$)/);
  if (!m) return [];
  const seen = new Set<string>();
  for (const line of m[1].split("\n")) {
    const skill = line.replace(/^-\s*/, "").replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase();
    if (skill) seen.add(skill);
  }
  return Array.from(seen);
}

function skillHits(text: string, skills: string[]): string[] {
  const lower = text.toLowerCase();
  return skills.filter(s => lower.includes(s.toLowerCase()));
}

function extractItems(tex: string): string[] {
  return tex
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.startsWith("\\item"))
    .map(line => normalizeBlock(line));
}

function extractSkillsBlock(tex: string): string {
  return tex.match(/\\section\*\{SKILLS\}([\s\S]*?)\\section\*\{EXPERIENCE\}/)?.[1]?.trim() ?? "";
}

function normalizeBlock(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function stripLatex(tex: string): string {
  return tex
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?(?:\{([^{}]*)\})?/g, "$1")
    .replace(/[{}\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCoverBody(tex: string): string {
  const body = tex.match(/% === BODY \(LLM-generated\) ===\n([\s\S]*?)\n\\vspace\{8pt\}\n\n% === SIGN-OFF ===/)?.[1] ?? tex;
  return stripLatex(body);
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function countMatches(text: string, regex: RegExp): number {
  if (!text) return 0;
  const flags = regex.flags.includes("g") ? regex.flags : regex.flags + "g";
  return Array.from(text.matchAll(new RegExp(regex.source, flags))).length;
}

function looksTruncated(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  return !/[.!?"]$/.test(t);
}

function unsafeVisaWording(text: string): boolean {
  return /without sponsorship|do not require sponsorship|no sponsorship required/i.test(text);
}

function detectStackMismatches(resume: string, cover: string, meta: any): string[] {
  const signals: string[] = [];
  const swaps = meta?.judge?.tailoring_hints?.tech_swaps ?? [];
  for (const swap of swaps) {
    if (!swap?.from || !swap?.to || !swap?.target_role) continue;
    const role = String(swap.target_role);
    const from = String(swap.from);
    const to = String(swap.to);
    if (resume.includes(to) && cover.includes(role) && cover.includes(from)) {
      signals.push(`${role}: resume uses ${to}, cover still mentions ${from}`);
    }
  }
  return signals;
}

function extractTitle(jd: string): string | null {
  return jd.match(/^#\s+(.+)$/m)?.[1] ?? null;
}

function synthesize(jobs: ArtifactAudit[]): Array<{ pattern: string; count: number; fix: string }> {
  const patterns = [
    ["banned style phrases", jobs.filter(j => j.risk_issues.some(r => r.includes("style"))).length, "Issue 1 prompt rule"],
    ["dash forms", jobs.filter(j => j.risk_issues.some(r => r.includes("dash"))).length, "Issue 2 prompt rule plus stripDashes"],
    ["truncated or short covers", jobs.filter(j => j.risk_issues.some(r => r.includes("truncated"))).length, "Issue 3 retry and truncation guard"],
    ["skills section pollution", jobs.filter(j => j.risk_issues.some(r => r.includes("SKILLS"))).length, "Round-1 SKILLS atomicity plus audit"],
    ["employer-stack mismatch", jobs.filter(j => j.risk_issues.some(r => r.includes("stack"))).length, "Issue 1 dynamic cover-letter attribution"],
    ["fabrication overrun", jobs.filter(j => j.risk_issues.some(r => r.includes("fabricated role"))).length, "Issue 7 soft gate flag"],
    ["extractor recall misses", jobs.filter(j => j.risk_issues.some(r => r.includes("JD skill"))).length, "Issue 5 segmentation and model switch"],
  ] as const;
  return patterns
    .filter(([, count]) => count > 0)
    .map(([pattern, count, fix]) => ({ pattern, count, fix }));
}

function renderMarkdown(report: AuditReport): string {
  const lines = [
    "# Round-2 Artifact Quality Baseline",
    "",
    `Generated: ${report.generated_at}`,
    `Baseline resume: ${report.baseline_resume}`,
    "",
    "## Totals",
    "",
    ...Object.entries(report.totals).map(([k, v]) => `- ${k}: ${v}`),
    "",
    "## Synthesis",
    "",
    ...report.synthesis.map(s => `- ${s.pattern}: ${s.count}. Fix: ${s.fix}`),
    "",
    "## Jobs",
    "",
  ];

  for (const job of report.jobs) {
    lines.push(`### ${job.company} - ${job.job_title}`);
    lines.push(`- run: ${job.run_folder}`);
    lines.push(`- folder: ${job.job_folder}`);
    lines.push(`- better_than_original: ${job.better_than_original}`);
    lines.push(`- why_better: ${job.why_better.join("; ")}`);
    lines.push(`- risk_issues: ${job.risk_issues.join("; ") || "none"}`);
    lines.push(`- fix_category: ${job.fix_category.join(", ") || "none"}`);
    if (job.resume) {
      lines.push(`- resume: ${job.resume.word_count} words, gained skills ${job.resume.gained_skill_hits.join(", ") || "none"}, added/modified claims ${job.resume.added_or_modified_claims}, fabricated_role_attribution ${job.resume.fabricated_role_attribution}`);
    }
    if (job.cover_letter) {
      lines.push(`- cover_letter: ${job.cover_letter.word_count} words, truncated ${job.cover_letter.truncated}, stack mismatches ${job.cover_letter.stack_mismatch_signals.join("; ") || "none"}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

main();
