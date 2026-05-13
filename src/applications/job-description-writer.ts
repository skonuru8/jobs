import * as fs   from "fs";
import * as path from "path";

import type { ArtifactBundleOk } from "@/shared/artifact-bundle";

export function writeJobDescription(
  bundle: ArtifactBundleOk,
  jobFolderAbs: string,
): string {
  fs.mkdirSync(jobFolderAbs, { recursive: true });
  const mdPath = path.join(jobFolderAbs, "job_description.md");
  const md = buildJobDescriptionMarkdown(bundle);
  fs.writeFileSync(mdPath, md, "utf8");
  return mdPath;
}

function escMd(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/`/g, "'").trim();
}

function fmtPosted(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  try {
    return iso.slice(0, 10);
  } catch {
    return String(iso);
  }
}

export function buildJobDescriptionMarkdown(bundle: ArtifactBundleOk): string {
  const j = bundle.job;
  const judge = bundle.judge_json;
  const score = bundle.score;
  const meta = j.meta;
  const companyLoc = (j.location?.cities ?? []).concat(j.location?.countries ?? []).filter(Boolean).join(", ") || "—";

  const verdict = judge.verdict ?? "—";
  const conf = typeof judge.confidence === "number" ? judge.confidence.toFixed(2) : "—";
  const total = score.total.toFixed(3);
  const c = score.components;

  const judgeNotes = judge.reasoning?.trim() || "—";

  const keyMatches = (judge.key_matches ?? []).map(k => `- ${k}`).join("\n") || "- —";
  const gapsLines = (judge.gaps ?? []).map(g => {
    const sev = "severity" in g ? g.severity : "minor";
    const req = "requirement" in g ? g.requirement : String(g);
    const ra = "reframe_angle" in g ? g.reframe_angle : "";
    return `- **${req}** (${sev}): ${ra}`;
  }).join("\n") || "- —";

  const skillsLines = (j.required_skills ?? [])
    .slice(0, 40)
    .map(s => {
      const yr = s.years_required != null ? `, ${s.years_required}+ yrs` : "";
      return `- ${s.name} (${s.importance}${yr})`;
    })
    .join("\n") || "- —";

  const respLines = (j.responsibilities ?? []).slice(0, 30).map(r => `- ${r}`).join("\n") || "- —";

  const raw = escMd(j.description_raw ?? "").slice(0, 80_000);

  return [
    `# ${j.title || "Job"}`,
    `**Company:** ${j.company?.name ?? "—"}  `,
    `**Location:** ${companyLoc}  `,
    `**Domain:** ${j.domain ?? "—"}  `,
    `**Posted:** ${fmtPosted(meta.posted_at)}  `,
    `**Source:** ${meta.source_url || "—"}`,
    "",
    "## Score & Verdict",
    `- **Verdict:** ${verdict} (confidence ${conf})`,
    `- **Total Score:** ${total}`,
    `- **Component Scores:** skills ${c.skills.toFixed(2)} / semantic ${c.semantic.toFixed(2)} / yoe ${c.yoe.toFixed(2)} / seniority ${c.seniority.toFixed(2)} / location ${c.location.toFixed(2)}`,
    "",
    "## Judge Notes",
    judgeNotes,
    "",
    "### Key Matches",
    keyMatches,
    "",
    "### Gaps Addressed",
    gapsLines,
    "",
    "## Required Skills",
    skillsLines,
    "",
    "## Responsibilities",
    respLines,
    "",
    "## Raw Description",
    raw || "—",
    "",
  ].join("\n");
}
