/**
 * latex-utils.ts — Pure LaTeX escaping and cover-letter template helpers.
 *
 * No I/O, no LLM calls. All functions are deterministic text transforms.
 *
 * Called by: saver.ts
 * Writes to: nothing
 * Side effects: none
 */

import type { ArtifactBundleOk } from "@/shared/artifact-bundle";

/**
 * Escapes LaTeX-sensitive characters in generated body prose.
 *
 * @param raw - Generated cover letter body before template insertion.
 * @returns LaTeX-safe body text suitable for `<<BODY>>`.
 */
export function escapeLatexBody(raw: string): string {
  let s = raw;
  s = s.replace(/\\/g, "\\textbackslash{}");
  s = s.replace(/%/g, "\\%");
  s = s.replace(/&/g, "\\&");
  s = s.replace(/\$/g, "\\$");
  s = s.replace(/#/g, "\\#");
  s = s.replace(/_/g, "\\_");
  s = s.replace(/~/g, "\\textasciitilde{}");
  s = s.replace(/\^/g, "\\textasciicircum{}");
  return s;
}

/**
 * Escapes LaTeX-sensitive characters for single-line template fields.
 *
 * @param raw - Plain text field value such as company name or contact info.
 * @returns LaTeX-safe single-line string.
 */
export function escapeLatexPlain(raw: string): string {
  return escapeLatexBody(raw).replace(/\n/g, " ");
}

/**
 * Detects likely raw LaTeX leakage in generated prose before templating.
 *
 * @param body - Generated cover letter prose body.
 * @returns `true` when the body appears to contain raw LaTeX markup.
 */
export function bodyHasLatexLeak(body: string): boolean {
  const open = (body.match(/\{/g) ?? []).length;
  const close = (body.match(/\}/g) ?? []).length;
  const hasCommand = /\\[a-zA-Z]+/.test(body);
  return open > 0 || close > 0 || hasCommand;
}

/**
 * Performs final sanity checks on rendered LaTeX before writing artifacts.
 *
 * @param tex - Fully substituted LaTeX document.
 * @returns `true` when document markers and brace balance look plausible.
 */
export function finalTexValid(tex: string): boolean {
  const open = (tex.match(/\{/g) ?? []).length;
  const close = (tex.match(/\}/g) ?? []).length;
  return (
    tex.includes("\\begin{document}")
    && tex.includes("\\end{document}")
    && Math.abs(open - close) <= 1
  );
}

/**
 * Formats current date for the LaTeX template's letter header.
 *
 * @returns Locale-formatted US date like `June 3, 2026`.
 */
export function formatLetterDate(): string {
  return new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Converts optional company location into template-ready LaTeX line break content.
 *
 * @param loc - Human-readable job location line, if available.
 * @returns Escaped LaTeX string prefixed with line break markup, or empty string.
 */
export function formatCompanyLocationLine(loc: string | null | undefined): string {
  if (!loc?.trim()) return "";
  return `\\\\\n${escapeLatexPlain(loc.trim())}`;
}

/**
 * Picks a neutral salutation target from raw job description text.
 *
 * @param bundle - Artifact bundle containing raw job description text.
 * @returns `Manager` or `Team` based on detected recruiting phrasing.
 */
export function deriveSalutation(bundle: ArtifactBundleOk): string {
  const raw = (bundle.job.description_raw ?? "").slice(0, 12000);
  if (/\bhiring\s+manager\b/i.test(raw)) return "Manager";
  if (/\brecruiting\s+team\b|\btalent\s+acquisition\s+team\b|\bhiring\s+team\b/i.test(raw)) {
    return "Team";
  }
  return "Manager";
}
