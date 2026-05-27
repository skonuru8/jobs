import { getAllJdTargetKeys, lookupJdSkill } from "./lookup";
import type { LedgerEntryInput, RiskSummary } from "./types";

/**
 * Split a tex string into role-scoped bullet blocks.
 * A "role block" is keyed by the nearest preceding employer-header line.
 * Returns a map of { roleKey -> string[] of bullet texts }.
 *
 * Employer-header detection: lines containing \textbf{...} followed by \hfill
 * or by a date pattern. Sub-project headers (\textbf{Project: X}) become
 * separate keys under the parent employer (e.g., "Hitachi Vantara / Nokia").
 */
function extractBulletsByRole(tex: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  let currentEmployer = "(no employer)";
  let currentSubProject: string | null = null;
  let currentBullets: string[] = [];

  const flush = () => {
    const key = currentSubProject
      ? `${currentEmployer} / ${currentSubProject}`
      : currentEmployer;
    const existing = result.get(key) ?? [];
    result.set(key, existing.concat(currentBullets));
    currentBullets = [];
  };

  const expMatch = tex.match(/\\section\*?\{EXPERIENCE\}([\s\S]*?)(?=\\section\*?\{(?:PROJECTS|EDUCATION|AWARDS)\}|$)/);
  const expTex = expMatch?.[1] ?? tex;
  const lines = expTex.split("\n");
  for (const line of lines) {
    const employerMatch = line.match(/\\textbf\{([^}]+)\}\s*\\hfill/);
    if (employerMatch && /\d{4}/.test(line)) {
      flush();
      currentEmployer = employerMatch[1].trim();
      currentSubProject = null;
      continue;
    }
    const projectMatch = line.match(/\\textbf\{Project:\s*([^}]+)\}/);
    if (projectMatch) {
      flush();
      currentSubProject = projectMatch[1].trim();
      continue;
    }
    const itemMatch = line.match(/\\item\s+(.*)/);
    if (itemMatch) {
      currentBullets.push(itemMatch[1].trim());
    }
  }
  flush();
  return result;
}

/**
 * Normalize a bullet for fuzzy comparison: lowercase, strip LaTeX commands,
 * collapse whitespace. Used to decide whether a generated bullet matches any
 * canonical bullet in the same role.
 */
function normalizeBulletForCompare(s: string): string {
  return s
    .replace(/\\textbf\{([^}]*)\}/g, "$1")
    .replace(/\\textit\{([^}]*)\}/g, "$1")
    .replace(/\\[a-zA-Z]+\{?/g, "")
    .replace(/[}{]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

function extractBoldTechCandidates(bullet: string): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];
  const matches = bullet.matchAll(/\\textbf\{([^}]+)\}/g);
  for (const match of matches) {
    const value = match[1].trim();
    if (!value) continue;
    if (/\d/.test(value) || value.length < 3) continue;
    if (!/[A-Za-z]/.test(value)) continue;
    const normalized = value.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    candidates.push(value);
  }
  return candidates;
}

/**
 * For each role in the generated tex, find bullets that do not match any
 * canonical bullet in the same role. Within each new bullet, find tech tokens
 * from the supplied registry. Each such (role, bullet, tech) triple is a
 * fabricated_role_attribution.
 *
 * Matching heuristic: a generated bullet is "new" if no canonical bullet in
 * the same role shares >= 5 consecutive normalized words with it.
 */
export interface RoleAttributionFinding {
  role: string;
  bullet: string;
  tech: string;
}

export function auditRoleAttribution(
  canonicalTex: string,
  generatedTex: string,
  techRegistry: string[],
): RoleAttributionFinding[] {
  const effectiveRegistry = techRegistry.length > 0 ? techRegistry : getAllJdTargetKeys();
  const canonByRole = extractBulletsByRole(canonicalTex);
  const genByRole = extractBulletsByRole(generatedTex);

  const findings: RoleAttributionFinding[] = [];

  const canonNormByRole = new Map<string, string[]>();
  for (const [role, bullets] of canonByRole) {
    canonNormByRole.set(role, bullets.map(normalizeBulletForCompare));
  }

  const hasOverlap = (genNorm: string, canonNorms: string[]): boolean => {
    const genWords = genNorm.split(" ").filter(w => w.length > 0);
    for (const canon of canonNorms) {
      for (let i = 0; i + 5 <= genWords.length; i++) {
        const slice = genWords.slice(i, i + 5).join(" ");
        if (canon.includes(slice)) return true;
      }
    }
    return false;
  };

  for (const [role, genBullets] of genByRole) {
    const canonNorms = canonNormByRole.get(role) ?? [];
    for (const bullet of genBullets) {
      const norm = normalizeBulletForCompare(bullet);
      if (norm.length < 20) continue;
      if (hasOverlap(norm, canonNorms)) continue;
      const detectedTechs = new Set<string>();
      for (const tech of effectiveRegistry) {
        const t = tech.toLowerCase();
        if (t.length < 3) continue;
        const re = new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
        if (re.test(norm)) {
          detectedTechs.add(tech);
        }
      }
      for (const tech of extractBoldTechCandidates(bullet)) {
        detectedTechs.add(tech);
      }
      for (const tech of detectedTechs) {
        findings.push({ role, bullet: bullet.slice(0, 200), tech });
      }
    }
  }
  return findings;
}

interface AuditInput {
  tailoredText:  string;
  canonicalText: string;
  jobId:         string;
  runId:         string | null;
  artifactType:  "resume" | "cover_letter";
}

export function auditTailoredArtifact(input: AuditInput): {
  summary: RiskSummary;
  ledger:  LedgerEntryInput[];
} {
  const { tailoredText, canonicalText, jobId, runId, artifactType } = input;
  const tailoredLower  = tailoredText.toLowerCase();
  const canonicalLower = canonicalText.toLowerCase();

  const counts = {
    exact: 0, reworded: 0, direct_equivalent: 0,
    adjacent: 0, unsupported_inference: 0, fabricated: 0,
    fabricated_role_attribution: 0,
  };
  const humanReviewItems: RiskSummary["human_review_items"] = [];
  const ledger: LedgerEntryInput[] = [];
  const techRegistry = getAllJdTargetKeys();

  for (const targetKey of getAllJdTargetKeys()) {
    if (!termPresent(tailoredLower, targetKey)) continue;

    const entry = lookupJdSkill(targetKey);
    if (!entry) continue;

    const sourceInCanonical = termPresent(
      canonicalLower,
      entry.candidate_source_skill.toLowerCase(),
    );

    const effectiveRel = sourceInCanonical ? entry.relationship
                       : entry.relationship === "exact" ? "fabricated"
                       : entry.relationship;

    counts[effectiveRel]++;

    if (entry.requires_human_review) {
      humanReviewItems.push({
        text:         entry.target_skill,
        relationship: effectiveRel,
        reason:       entry.evidence_basis ?? `${entry.relationship} mapping to ${entry.candidate_source_skill}`,
      });
    }

    ledger.push({
      job_id:                   jobId,
      run_id:                   runId,
      artifact_type:            artifactType,
      jd_skill:                 entry.target_skill,
      canonical_skill_found:    sourceInCanonical ? entry.candidate_source_skill : null,
      generated_skill_or_claim: entry.target_skill,
      change_type:              effectiveRel,
      truth_distance_score:     effectiveRel === "fabricated" && entry.relationship !== "fabricated" ? 5 : entry.truth_distance_score,
      fabrication_risk:         entry.fabrication_risk,
      location:                 guessLocation(tailoredText, entry.target_skill),
      human_review_required:    entry.requires_human_review,
    });
  }

  const roleFindings = auditRoleAttribution(canonicalText, tailoredText, techRegistry);
  for (const finding of roleFindings) {
    counts.fabricated_role_attribution++;
    ledger.push({
      job_id:                   jobId,
      run_id:                   runId,
      artifact_type:            artifactType,
      jd_skill:                 null,
      canonical_skill_found:    null,
      generated_skill_or_claim: `${finding.role}: ${finding.tech} :: ${finding.bullet}`,
      change_type:              "fabricated_role_attribution",
      truth_distance_score:     5,
      fabrication_risk:         "high",
      location:                 "experience",
      human_review_required:    true,
    });
  }

  return {
    summary: {
      counts,
      human_review_items:   humanReviewItems,
      total_claims_audited: Object.values(counts).reduce((a, b) => a + b, 0),
    },
    ledger,
  };
}

export function applyResumeAttributionOverrunFlag(
  flags: string[],
  summary: Pick<RiskSummary, "counts">,
): void {
  const fab = summary.counts.fabricated_role_attribution ?? 0;
  if (fab > 3 && !flags.includes("resume_attribution_overrun")) {
    flags.push("resume_attribution_overrun");
  }
}

function termPresent(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pat = new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`, "i");
  return pat.test(haystack);
}

function guessLocation(tex: string, term: string): LedgerEntryInput["location"] {
  const sections: Array<[LedgerEntryInput["location"], RegExp]> = [
    ["summary",    /summary([\s\S]*?)(?=skills|experience|projects|education|$)/i],
    ["skills",     /skills([\s\S]*?)(?=experience|projects|education|$)/i],
    ["experience", /experience([\s\S]*?)(?=projects|education|awards|$)/i],
    ["projects",   /projects([\s\S]*?)(?=education|awards|$)/i],
  ];
  for (const [name, re] of sections) {
    const m = tex.match(re);
    if (m && m[1].toLowerCase().includes(term.toLowerCase())) return name;
  }
  return "unknown";
}
