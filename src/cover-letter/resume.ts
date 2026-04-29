/**
 * resume.ts — load and normalize resume text for cover letter generation.
 *
 * Primary format: config/resume.tex (LaTeX, stripped to plain text).
 * Fallback:       config/resume.md  (plain text / markdown, used as-is).
 *
 * Returns null if no file found or the file is still the unfilled placeholder.
 */

import * as fs   from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load resume text from configDir, stripping LaTeX if needed.
 * Returns plain text suitable for embedding in an LLM prompt, or null.
 */
export function loadResume(configDir: string): string | null {
  const texPath = path.join(configDir, "resume.tex");
  const mdPath  = path.join(configDir, "resume.md");

  if (fs.existsSync(texPath)) {
    const raw = fs.readFileSync(texPath, "utf-8");
    const text = stripLatex(raw).trim();
    if (text && !isPlaceholder(text)) return text;
  }

  if (fs.existsSync(mdPath)) {
    const raw = fs.readFileSync(mdPath, "utf-8").trim();
    if (raw && !isPlaceholder(raw)) return raw;
  }

  return null;
}

// ---------------------------------------------------------------------------
// LaTeX → plain text
// ---------------------------------------------------------------------------

/**
 * Strip LaTeX markup from a .tex source and return readable plain text.
 *
 * Handles:
 * - Preamble (\documentclass through \begin{document})
 * - \end{document} and \maketitle
 * - % comments
 * - \section{}, \subsection{}, \textbf{}, \textit{}, \emph{}, \href{}{}, etc.
 * - \begin{itemize/enumerate}...\end{...}
 * - \item
 * - \\ line breaks, \hspace, \vspace, \rule, \noindent, \newline
 * - Inline math $...$  (stripped)
 * - Display math $$...$$ (stripped)
 * - \begin{tabular}...\end{tabular} (columns joined)
 * - Collapses excessive whitespace/blank lines
 */
export function stripLatex(tex: string): string {
  let t = tex;

  // Remove preamble (\documentclass ... \begin{document})
  t = t.replace(/[\s\S]*?\\begin\{document\}/m, "");

  // Remove \end{document}
  t = t.replace(/\\end\{document\}/g, "");

  // Remove \maketitle, \clearpage, \newpage
  t = t.replace(/\\(maketitle|clearpage|newpage|tableofcontents)\b/g, "");

  // Remove % line comments (but not \%)
  t = t.replace(/(?<!\\)%.*$/gm, "");

  // Remove display math $$...$$
  t = t.replace(/\$\$[\s\S]*?\$\$/g, "");

  // Remove inline math $...$
  t = t.replace(/\$[^$\n]*?\$/g, "");

  // \href{url}{text} → text
  t = t.replace(/\\href\{[^}]*\}\{([^}]*)\}/g, "$1");

  // \hyperlink{id}{text} → text
  t = t.replace(/\\hyperlink\{[^}]*\}\{([^}]*)\}/g, "$1");

  // \section{text}, \subsection, \subsubsection → text (with newline)
  t = t.replace(/\\(?:sub)*section\*?\{([^}]*)\}/g, "\n$1\n");

  // \textbf{text}, \textit{text}, \emph{text}, \underline{text}, \texttt → text
  t = t.replace(/\\(?:textbf|textit|emph|underline|texttt|textsc|textrm|textsf)\{([^}]*)\}/g, "$1");

  // \colorbox{color}{text}, \fbox{text}, \mbox{text} → text
  t = t.replace(/\\(?:colorbox|fbox|mbox|makebox)\{[^}]*\}\{([^}]*)\}/g, "$1");
  t = t.replace(/\\(?:fbox|mbox)\{([^}]*)\}/g, "$1");

  // \fontsize{}{}\selectfont → empty
  t = t.replace(/\\fontsize\{[^}]*\}\{[^}]*\}\\selectfont/g, "");

  // \vspace{}, \hspace{}, \setlength{}{}, \rule{}{}, \kern, \skip → empty
  t = t.replace(/\\(?:vspace|hspace|kern|setlength|addtolength|setcounter)\*?\{[^}]*\}(\{[^}]*\})?/g, "");
  t = t.replace(/\\rule\{[^}]*\}\{[^}]*\}/g, "");

  // \begin{itemize|enumerate|description} and \end{...} → empty
  t = t.replace(/\\(?:begin|end)\{(?:itemize|enumerate|description|list)\}/g, "");

  // \begin{center|flushleft|flushright} and \end → empty
  t = t.replace(/\\(?:begin|end)\{(?:center|flushleft|flushright|minipage|tabbing)\}(\[[^\]]*\])?(\{[^}]*\})?/g, "");

  // \begin{tabular}{...} — drop the column spec
  t = t.replace(/\\begin\{tabular\}\{[^}]*\}/g, "");
  t = t.replace(/\\end\{tabular\}/g, "");

  // \hline → empty line
  t = t.replace(/\\hline/g, "");

  // & column separator in tabular → space
  t = t.replace(/\s*&\s*/g, "  ");

  // \item → bullet
  t = t.replace(/\\item\s*/g, "• ");

  // \\ line break → newline
  t = t.replace(/\\\\/g, "\n");

  // \noindent, \indent → empty
  t = t.replace(/\\(?:noindent|indent)\b/g, "");

  // \newline → newline
  t = t.replace(/\\newline\b/g, "\n");

  // \medskip, \bigskip, \smallskip → blank line
  t = t.replace(/\\(?:medskip|bigskip|smallskip)\b/g, "\n");

  // \color{...}{text} or \textcolor{...}{text} → text
  t = t.replace(/\\textcolor\{[^}]*\}\{([^}]*)\}/g, "$1");
  t = t.replace(/\\color\{[^}]*\}/g, "");

  // Any remaining \command{text} → text (single brace group)
  t = t.replace(/\\[a-zA-Z]+\*?\{([^}]*)\}/g, "$1");

  // Any remaining \command[opt]{text} → text
  t = t.replace(/\\[a-zA-Z]+\*?\[[^\]]*\]\{([^}]*)\}/g, "$1");

  // Any remaining bare \command → empty
  t = t.replace(/\\[a-zA-Z]+\*?\b/g, "");

  // Remaining { } braces → empty
  t = t.replace(/[{}]/g, "");

  // Collapse 3+ blank lines to 2
  t = t.replace(/\n{3,}/g, "\n\n");

  // Trim trailing whitespace per line
  t = t.split("\n").map(l => l.trimEnd()).join("\n");

  return t.trim();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True if the text is still the placeholder we wrote, not a real resume. */
function isPlaceholder(text: string): boolean {
  return (
    text.includes("[Company Name]") ||
    text.includes("[Bullet 1") ||
    text.includes("[University Name]") ||
    text.includes("Fill in real bullet points")
  );
}
