import { getAllJdTargetKeys, lookupJdSkill } from "./lookup";
import type { LedgerEntryInput, RiskSummary } from "./types";

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
  };
  const humanReviewItems: RiskSummary["human_review_items"] = [];
  const ledger: LedgerEntryInput[] = [];

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

  return {
    summary: {
      counts,
      human_review_items:   humanReviewItems,
      total_claims_audited: Object.values(counts).reduce((a, b) => a + b, 0),
    },
    ledger,
  };
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
