/**
 * saver.ts — write tailored resume .tex, compile PDF, optional error log.
 */

import * as fs   from "fs";
import * as path from "path";

import { runPdflatex } from "@/shared/pdflatex";

export interface ResumeSaveResult {
  tex_path:       string;
  pdf_path:       string | null;
  compile_error?: string;
}

export async function writeTexAndCompile(
  texContent: string,
  jobFolderAbs: string,
  compilePdf: boolean,
): Promise<ResumeSaveResult> {
  fs.mkdirSync(jobFolderAbs, { recursive: true });
  const texAbs = path.join(jobFolderAbs, "resume.tex");
  fs.writeFileSync(texAbs, texContent, "utf8");

  if (!compilePdf) {
    return { tex_path: texAbs, pdf_path: null };
  }

  let lastLog = "";
  const pdfAbs = path.join(jobFolderAbs, "resume.pdf");
  if (fs.existsSync(pdfAbs)) {
    fs.unlinkSync(pdfAbs);
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await runPdflatex(texAbs, jobFolderAbs);
    lastLog = r.log;
    if (fs.existsSync(pdfAbs)) {
      cleanupAuxFiles(jobFolderAbs, "resume");
      return { tex_path: texAbs, pdf_path: pdfAbs };
    }
  }

  // Failure — keep aux files for debugging, write compile-error log
  fs.writeFileSync(
    path.join(jobFolderAbs, "resume.compile-error.log"),
    lastLog.slice(-24_000),
    "utf8",
  );
  return { tex_path: texAbs, pdf_path: null, compile_error: lastLog.slice(0, 2000) };
}

function cleanupAuxFiles(dir: string, basename: string): void {
  for (const ext of [".aux", ".log", ".out"]) {
    const p = path.join(dir, `${basename}${ext}`);
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch { /* ignore */ }
    }
  }
}
