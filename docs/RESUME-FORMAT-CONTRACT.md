# Resume Format Contract

The parsers `patch/parser.ts`, `judge/roles-extractor.ts`, and `cover-letter/resume-brief.ts`
assume one specific LaTeX dialect. Violating this silently empties role parsing.

This is deliberate coupling to one resume FORMAT, not hardcoded personal details.
Generalizing to support multiple formats would be a major project with zero
single-user benefit.

---

## Required section headers

```latex
\section*{SUMMARY}
\section*{SKILLS}
\section*{EXPERIENCE}
\section*{PROJECTS}
\section*{EDUCATION}
\section*{AWARDS}
```

## Required employer-level block shape

```latex
\textbf{Employer Name} \hfill Month YYYY - Month YYYY, City\\
\textit{Job Title}
\begin{itemize}
\item Bullet text...
\end{itemize}
```

## Required project sub-header shape (inside employer block)

```latex
\hspace{4mm}\textbf{Project: ProjectName}
\begin{itemize}
\item Bullet text...
\end{itemize}
```

- `\hspace{4mm}` prefix is required — identifies project sub-headers in the parser.
- `Project:` prefix (case-sensitive) is required — the space after `:` is canonical.
- Patch ops target `"Project: ProjectName"` exactly; any deviation breaks routing.

## One bullet per line

```latex
\item This is one bullet.
```

Multi-line bullets (wrapped `\item` text across lines) are NOT supported
by the patch applier. Each `\item` must start and end on the same line.

## What the employer `\textbf{...} \hfill` combination signals

- `\textbf{Name} \hfill dates` → employer-level header (has `\hfill`)
- `\hspace{4mm}\textbf{Project: X}` → project sub-header (has `\hspace`, no `\hfill`)

Both `roles-extractor.ts` and `patch/parser.ts` rely on this distinction.

---

## Smoke test

`test/resume-generator/canonical-contract.test.ts` runs `extractRoleBlocks` and
`extractRolesFromCanonicalTex` against the REAL `config/resume_master.tex` on every
CI run. A resume edit that breaks the dialect fails CI immediately instead of
producing silent empty-directive failures at runtime.
