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
  version: number,
  compilePdf: boolean,
): Promise<ResumeSaveResult> {
  fs.mkdirSync(jobFolderAbs, { recursive: true });
  const vBase = `v${version}`;
  const texAbs = path.join(jobFolderAbs, `${vBase}.tex`);
  fs.writeFileSync(texAbs, texContent, "utf8");

  if (!compilePdf) {
    return { tex_path: texAbs, pdf_path: null };
  }

  let lastLog = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await runPdflatex(texAbs, jobFolderAbs);
    lastLog = r.log;
    if (r.ok) {
      const pdfAbs = path.join(jobFolderAbs, `${vBase}.pdf`);
      if (fs.existsSync(pdfAbs)) {
        return { tex_path: texAbs, pdf_path: pdfAbs };
      }
    }
  }

  fs.writeFileSync(
    path.join(jobFolderAbs, `${vBase}.compile-error.log`),
    lastLog.slice(-24_000),
    "utf8",
  );
  return { tex_path: texAbs, pdf_path: null, compile_error: lastLog.slice(0, 2000) };
}

export function copyLatestResume(dir: string, version: number, hasPdf: boolean): void {
  const vBase = `v${version}`;
  fs.copyFileSync(path.join(dir, `${vBase}.tex`), path.join(dir, "latest.tex"));
  if (hasPdf) {
    fs.copyFileSync(path.join(dir, `${vBase}.pdf`), path.join(dir, "latest.pdf"));
  }
}
