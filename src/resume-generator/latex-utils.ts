/**
 * latex-utils.ts — Pure LaTeX text processing utilities for resume generation.
 *
 * No LLM calls, no I/O. All functions are deterministic transforms on strings.
 *
 * Called by: generator.ts, patch/orchestrator.ts
 * Writes to: nothing
 * Side effects: none
 */

import { stripLatex } from "@/cover-letter/resume";

/**
 * Strips Markdown code fences from model output when present.
 *
 * @param s - Raw model text that may be wrapped in fenced code blocks.
 * @returns Trimmed text without outer Markdown fences.
 */
export function stripFences(s: string): string {
  return s
    .replace(/^```(?:latex|tex)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

/**
 * Extracts best LaTeX slice starting at `\\documentclass` from model output.
 *
 * @param s - Fence-stripped model output.
 * @returns Full document slice when both boundaries exist, otherwise best-effort truncated tail.
 */
export function extractLatexDocument(s: string): string {
  const start = s.indexOf("\\documentclass");
  if (start < 0) return s;
  const end = s.lastIndexOf("\\end{document}");
  if (end >= start) return s.slice(start, end + "\\end{document}".length).trim();
  return s.slice(start).trim();
}

/**
 * Best-effort repair of a LaTeX doc truncated before \end{document}.
 * 1) drop a trailing incomplete macro line (unbalanced braces)
 * 2) close still-open environments in LIFO order
 * 3) close the document
 *
 * @param partial - Truncated LaTeX text accepted only as last-resort salvage input.
 * @returns Recovered LaTeX with obvious trailing damage removed and document closed.
 */
export function recoverTruncatedLatex(partial: string): string {
  const lines = partial.split("\n");
  while (lines.length > 0) {
    const last = lines[lines.length - 1].trim();
    if (!last) { lines.pop(); continue; }
    const open  = (last.match(/\{/g) ?? []).length;
    const close = (last.match(/\}/g) ?? []).length;
    if (open > close) { lines.pop(); } else { break; }
  }
  const cleaned = lines.join("\n");

  const stack: string[] = [];
  const re = /\\(begin|end)\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    if (m[1] === "begin") stack.push(m[2]);
    else if (stack.length > 0 && stack[stack.length - 1] === m[2]) stack.pop();
  }

  let out = cleaned;
  for (const env of stack.reverse()) {
    if (env === "document") continue;
    out += `\n\\end{${env}}`;
  }
  if (!out.includes("\\end{document}")) out += "\n\\end{document}";
  return out.trim();
}

/**
 * Estimates rendered word count by stripping LaTeX commands first.
 *
 * @param tex - LaTeX document to analyze.
 * @returns Plain-text word count used for downstream min/max flagging.
 */
export function countWordsTex(tex: string): number {
  const plain = stripLatex(tex);
  return plain.split(/\s+/).filter(Boolean).length;
}

/**
 * Performs lightweight LaTeX sanity checks before compile stage.
 *
 * @param tex - Generated LaTeX document candidate.
 * @returns `true` when brace imbalance is small and document boundaries exist.
 */
export function latexStructureOk(tex: string): boolean {
  const open = (tex.match(/\{/g) ?? []).length;
  const close = (tex.match(/\}/g) ?? []).length;
  if (Math.abs(open - close) > 3) return false;
  return tex.includes("\\begin{document}") && tex.includes("\\end{document}");
}
