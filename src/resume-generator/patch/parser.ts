import type { ItemLine, RoleBlock } from "./types";

const EXPERIENCE_RE = /\\section\*?\{EXPERIENCE\}/i;
const NEXT_SECTION_RE = /\\section\*?\{(?:PROJECTS|EDUCATION|AWARDS|SKILLS|SUMMARY)\}/i;

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

export function findRoleBlock(blocks: RoleBlock[], role: string): RoleBlock | null {
  const needle = normalize(role);
  return blocks.find(b => normalize(b.role) === needle)
    ?? blocks.find(b => normalize(b.role).includes(needle) || needle.includes(normalize(b.role)))
    ?? null;
}

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

function cleanRoleName(line: string): string {
  const matches = [...line.matchAll(/\\textbf\{([^}]+)\}/g)].map(m => m[1].trim());
  const role = matches[0] ?? line;
  return role.replace(/^Project:\s*/i, "Project: ").replace(/\s+/g, " ").trim();
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

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

function trimTrailingNewlineEnd(tex: string, start: number, end: number): number {
  let n = end;
  while (n > start && (tex[n - 1] === "\n" || tex[n - 1] === "\r")) n--;
  return n;
}
