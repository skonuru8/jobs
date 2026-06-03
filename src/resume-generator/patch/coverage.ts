import type { GapDirective } from "@/judge/types";

import { extractRoleBlocks, findRoleBlock } from "./parser";
import type { PatchCoverage } from "./types";

const STOPWORDS = new Set([
  "with", "from", "that", "this", "your", "role", "using", "have", "into",
  "and", "for", "the", "are", "was", "were", "will", "their", "across",
]);

export function verifyPatchCoverage(tex: string, directives: GapDirective[]): PatchCoverage {
  const active = directives.filter(d =>
    (d.handling === "fabricate" || d.handling === "reframe") && d.target_role,
  );
  const blocks = extractRoleBlocks(tex);
  const missed: string[] = [];

  for (const d of active) {
    const block = findRoleBlock(blocks, d.target_role ?? "");
    if (!block) {
      missed.push(d.jd_requirement);
      continue;
    }
    const roleText = tex.slice(block.startOffset, block.endOffset).toLowerCase();
    const terms = keywords(`${d.jd_requirement} ${d.frame_as ?? ""}`);
    if (terms.length === 0 || !terms.some(t => roleText.includes(t))) {
      missed.push(d.jd_requirement);
    }
  }

  return {
    covered: active.length - missed.length,
    total: active.length,
    missed,
  };
}

function keywords(text: string): string[] {
  return [...new Set(
    text
      .toLowerCase()
      .replace(/\\[a-z]+/g, " ")
      .split(/[^a-z0-9+#.]+/g)
      .map(s => s.trim())
      .filter(s => s.length >= 4 && !STOPWORDS.has(s)),
  )].slice(0, 8);
}
