/**
 * parser.ts — EXPERIENCE-section role-block parser for patch mode.
 *
 * Extracts employer/project blocks and their itemized bullets from canonical
 * resume TeX so patch ops can target stable roles and 1-indexed bullet slots.
 * Parser is intentionally narrow: it only scans EXPERIENCE and stops at known
 * later sections to avoid mutating SUMMARY, SKILLS, or unrelated content.
 *
 * Called by: patch apply/coverage/orchestrator modules
 * Writes to: nothing
 * Side effects: none
 */

import type { ItemLine, RoleBlock } from "./types";

/** Detects start of EXPERIENCE section where patchable role blocks live. */
const EXPERIENCE_RE = /\\section\*?\{EXPERIENCE\}/i;
/** Detects first later section that ends EXPERIENCE parsing window. */
const NEXT_SECTION_RE = /\\section\*?\{(?:PROJECTS|EDUCATION|AWARDS|SKILLS|SUMMARY)\}/i;

/**
 * Parses patchable role blocks from resume EXPERIENCE section.
 *
 * Only blocks that contain both a role heading and a concrete `itemize` list
 * are returned. Empty or malformed role sections are skipped so downstream
 * patch application can remain deterministic.
 *
 * @param tex - Canonical resume LaTeX source to inspect.
 * @returns Parsed role blocks in source order, or empty array when EXPERIENCE is absent.
 */
export function extractRoleBlocks(tex: string): RoleBlock[] {
  const expMatch = EXPERIENCE_RE.exec(tex);
  if (!expMatch) return [];

  const expStart = expMatch.index + expMatch[0].length;
  const rest = tex.slice(expStart);
  const nextMatch = NEXT_SECTION_RE.exec(rest);
  const expEnd = nextMatch ? expStart + nextMatch.index : tex.length;
  const lines = withOffsets(tex);
  const roleLines = lines.filter(l =>
    l.start >= expStart &&
    l.start < expEnd &&
    /\\textbf\{/.test(l.text) &&
    !/\\item/.test(l.text)
  );

  const blocks: RoleBlock[] = [];
  for (let i = 0; i < roleLines.length; i++) {
    const current = roleLines[i];
    const next = roleLines[i + 1]?.start ?? expEnd;
    const slice = tex.slice(current.start, next);
    const beginRel = slice.indexOf("\\begin{itemize}");
    const endRel = slice.indexOf("\\end{itemize}", beginRel >= 0 ? beginRel : 0);
    if (beginRel < 0 || endRel < 0) continue;

    const blockStart = current.start;
    const blockEnd = current.start + endRel + "\\end{itemize}".length;
    const itemizeEndOffset = current.start + endRel;
    const items = extractItems(tex, current.start + beginRel, itemizeEndOffset, lines);
    if (items.length === 0) continue;

    blocks.push({
      role: cleanRoleName(current.text),
      line: current.line,
      startOffset: blockStart,
      endOffset: blockEnd,
      itemizeEndOffset,
      items,
    });
  }
  return blocks;
}

/**
 * Finds best-matching parsed role block for LLM-emitted role label.
 *
 * Matching first tries normalized equality, then substring-style fallback so
 * minor formatting differences between prompt context and canonical TeX do not
 * invalidate otherwise safe patch ops.
 *
 * @param blocks - Parsed role blocks from `extractRoleBlocks`.
 * @param role - Role label emitted by planner or directive target.
 * @returns Matching role block, or `null` when no safe target exists.
 */
export function findRoleBlock(blocks: RoleBlock[], role: string): RoleBlock | null {
  const needle = normalize(role);
  return blocks.find(b => normalize(b.role) === needle)
    ?? blocks.find(b => {
      const nb = normalize(b.role);
      return nb.length >= 5 && needle.length >= 5 && (nb.includes(needle) || needle.includes(nb));
    })
    ?? null;
}

/**
 * Parses bullet items inside one `itemize` region.
 *
 * Multi-line bullet text is preserved by slicing from each `\item` start to
 * next item boundary, not by per-line extraction. That keeps rewrite offsets
 * stable for downstream patch application.
 *
 * @param tex - Full canonical resume LaTeX.
 * @param itemizeStart - Byte offset where target `itemize` region begins.
 * @param itemizeEnd - Byte offset where target `itemize` region ends.
 * @param lines - Precomputed line/offset index for `tex`.
 * @returns Ordered bullet descriptors with 1-indexed positions and byte offsets.
 */
function extractItems(
  tex: string,
  itemizeStart: number,
  itemizeEnd: number,
  lines: Array<{ text: string; start: number; end: number; line: number }>,
): ItemLine[] {
  const itemLines = lines.filter(l =>
    l.start >= itemizeStart &&
    l.start < itemizeEnd &&
    /^\s*\\item\b/.test(l.text)
  );
  return itemLines.map((l, idx) => {
    const next = itemLines[idx + 1]?.start ?? itemizeEnd;
    return {
      index: idx + 1,
      text: tex.slice(l.start, next).trim(),
      line: l.line,
      startOffset: l.start,
      endOffset: trimTrailingNewlineEnd(tex, l.start, next),
    };
  });
}

/**
 * Extracts normalized role label from heading line.
 *
 * Patch mode matches on first `\textbf{...}` chunk because that is closest to
 * employer/project label shown to planner. Project-prefixed headings get light
 * normalization so downstream role matching stays stable.
 *
 * @param line - Raw role heading line from canonical TeX.
 * @returns Cleaned role label suitable for prompt context and matching.
 */
function cleanRoleName(line: string): string {
  const matches = [...line.matchAll(/\\textbf\{([^}]+)\}/g)].map(m => m[1].trim());
  const role = matches[0] ?? line;
  return role.replace(/^Project:\s*/i, "Project: ").replace(/\s+/g, " ").trim();
}

/**
 * Canonicalizes role text for fuzzy matching.
 *
 * @param s - Raw role string from TeX or planner output.
 * @returns Lowercased alphanumeric token string with punctuation collapsed.
 */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Builds line index with byte offsets for entire TeX string.
 *
 * Offsets are precomputed once so parser and applier can slice exact source
 * segments without re-scanning character positions repeatedly.
 *
 * @param tex - Full canonical resume LaTeX.
 * @returns Per-line text plus start/end offsets and 1-indexed line numbers.
 */
function withOffsets(tex: string): Array<{ text: string; start: number; end: number; line: number }> {
  const out: Array<{ text: string; start: number; end: number; line: number }> = [];
  let offset = 0;
  const lines = tex.split(/(?<=\n)/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    out.push({ text: raw.replace(/\n$/, ""), start: offset, end: offset + raw.length, line: i + 1 });
    offset += raw.length;
  }
  return out;
}

/**
 * Trims trailing newline bytes from item slice boundary.
 *
 * This keeps rewrite insertion points aligned to visible bullet content rather
 * than accidental newline padding that belongs to next splice boundary.
 *
 * @param tex - Full canonical resume LaTeX.
 * @param start - Slice start offset used as lower bound.
 * @param end - Slice end offset before newline trimming.
 * @returns End offset with trailing CR/LF bytes removed.
 */
function trimTrailingNewlineEnd(tex: string, start: number, end: number): number {
  let n = end;
  while (n > start && (tex[n - 1] === "\n" || tex[n - 1] === "\r")) n--;
  return n;
}
