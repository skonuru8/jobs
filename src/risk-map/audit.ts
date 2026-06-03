/**
 * audit.ts — Audit tailored artifacts for unsupported claims and role attribution drift.
 *
 * Compares generated resume or cover-letter text against canonical resume evidence and
 * tech-equivalence mappings, then emits summary counts plus ledger rows for storage.
 * It also flags bullets that move technologies into roles where canonical history does
 * not support them.
 *
 * Called by: tailoring pipeline before persistence and review gating
 * Writes to: nothing directly
 * Side effects: scans generated text, canonical text, and risk-map registry in memory
 */

import { getAllJdTargetKeys, lookupJdSkill } from "./lookup";
import type { LedgerEntryInput, RiskSummary } from "./types";

/**
 * Splits LaTeX experience section into role-scoped bullet groups for attribution checks.
 *
 * Role matching depends on nearby employer and sub-project headers so later audit steps
 * can ask whether claim appeared under same role in canonical resume.
 *
 * @param tex - Canonical or generated LaTeX resume text.
 * @returns Role-keyed bullet map where each value preserves bullet text order.
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
 * Normalizes bullet text before fuzzy overlap comparison.
 *
 * Removes lightweight LaTeX formatting so matching focuses on semantic content rather
 * than markup differences between canonical and generated artifacts.
 *
 * @param s - Raw bullet text extracted from LaTeX.
 * @returns Lowercased, whitespace-collapsed comparison string.
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

/**
 * Extracts bolded technology tokens that generator intentionally emphasized.
 *
 * Bolded terms often represent explicit skills, so audit keeps them even when registry
 * lookup misses them. Filters out short, numeric, or duplicate fragments to avoid noise.
 *
 * @param bullet - Generated bullet text that may contain `\\textbf{...}` markers.
 * @returns Distinct technology candidates in display order.
 */
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
 * Role-attribution audit hit for technology mentioned under unsupported role context.
 */
export interface RoleAttributionFinding {
  /** Employer or employer/sub-project key where generated claim appears. */
  role: string;
  /** Truncated generated bullet text used for reviewer context and ledger storage. */
  bullet: string;
  /** Technology token that appears newly attributed to this role. */
  tech: string;
}

/**
 * Finds technologies that appear in new generated bullets under roles lacking canonical support.
 *
 * This protects against plausible-sounding resume edits that move real skills into wrong job,
 * which is often harder to spot than fully fabricated claims.
 *
 * @param canonicalTex - Untailored canonical LaTeX resume used as attribution ground truth.
 * @param generatedTex - Tailored LaTeX artifact being audited.
 * @param techRegistry - Known job-description target skills to scan for, or empty to use global registry.
 * @returns List of role/bullet/tech findings that should be recorded as fabricated role attribution.
 */
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
    const STOP = new Set([
      "the", "a", "an", "and", "or", "to", "of", "in", "on", "at", "for", "with", "by",
      "is", "was", "were", "been", "be", "has", "have", "had", "their", "this", "that",
      "from", "into", "using", "used", "our", "its", "across", "within", "between",
    ]);
    const contentWords = (s: string): Set<string> =>
      new Set(s.split(" ").filter(w => w.length > 2 && !STOP.has(w)));

    const genWords = contentWords(genNorm);
    if (genWords.size === 0) return true;

    for (const canon of canonNorms) {
      const canonWords = contentWords(canon);
      if (canonWords.size === 0) continue;
      const intersection = [...genWords].filter(w => canonWords.has(w)).length;
      const union = new Set([...genWords, ...canonWords]).size;
      if (union > 0 && intersection / union >= 0.45) return true;
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
  /** Tailored artifact text to inspect for risky claims. */
  tailoredText:  string;
  /** Canonical artifact text used as evidence baseline. */
  canonicalText: string;
  /** Application job identifier persisted with each ledger row. */
  jobId:         string;
  /** Pipeline run identifier, or `null` when audit runs outside batch pipeline. */
  runId:         string | null;
  /** Artifact family determines storage labeling for audit rows. */
  artifactType:  "resume" | "cover_letter";
}

/**
 * Audits tailored artifact text against canonical evidence and risk-map mappings.
 *
 * Produces both aggregate counts for reviewer summaries and normalized ledger rows for
 * persistence. Claims absent from canonical support are downgraded to fabrication even if
 * mapping table would otherwise classify them more optimistically.
 *
 * @param input - Tailored text, canonical source text, and run metadata for audit.
 * @returns Summary counts plus ledger rows ready for persistence.
 */
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

/**
 * Adds overrun flag when too many role-attribution violations appear in one artifact.
 *
 * Threshold intentionally stays low because repeated role drift is strong signal that
 * tailoring has started inventing chronology rather than tightening phrasing.
 *
 * @param flags - Mutable artifact flag list that will be updated in place.
 * @param summary - Relationship counts from audit summary.
 * @returns Nothing; mutates `flags` when threshold is exceeded.
 */
export function applyResumeAttributionOverrunFlag(
  flags: string[],
  summary: Pick<RiskSummary, "counts">,
): void {
  const fab = summary.counts.fabricated_role_attribution ?? 0;
  if (fab > 3 && !flags.includes("resume_attribution_overrun")) {
    flags.push("resume_attribution_overrun");
  }
}

/**
 * Tests whether needle appears as standalone skill token within larger text block.
 *
 * Boundary matching avoids false positives from partial-word overlaps such as vendor names
 * embedded inside unrelated longer strings.
 *
 * @param haystack - Lowercased text corpus to search.
 * @param needle - Skill or phrase to detect.
 * @returns `true` when phrase appears with non-alphanumeric boundaries.
 */
function termPresent(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pat = new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`, "i");
  return pat.test(haystack);
}

/**
 * Guesses which resume section contains audited term for downstream reviewer context.
 *
 * Section routing is heuristic, but good enough for storage and review UI where exact line
 * provenance is less important than narrowing search area.
 *
 * @param tex - Tailored artifact text to inspect.
 * @param term - Claim or skill to locate.
 * @returns Best-fit section label, or `unknown` when no section contains term.
 */
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
