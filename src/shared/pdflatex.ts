/**
 * pdflatex.ts — Shared PDF compilation and auxiliary-file cleanup utilities.
 *
 * Called by: resume-generator/saver, cover-letter/saver
 * Writes to: nothing directly
 * Side effects: pdflatex subprocess, file deletions for aux cleanup
 */

import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface PdflatexResult {
  ok: boolean;
  log: string;
}

/**
 * Deletes pdflatex auxiliary files (.aux, .log, .out) left after compilation.
 *
 * @param dir - Directory containing the compiled output files.
 * @param basename - Filename stem (without extension) matching the tex source.
 */
export function cleanupAuxFiles(dir: string, basename: string): void {
  for (const ext of [".aux", ".log", ".out"]) {
    const p = path.join(dir, `${basename}${ext}`);
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch { /* ignore */ }
    }
  }
}

export async function runPdflatex(texPathAbs: string, outputDirAbs: string): Promise<PdflatexResult> {
  try {
    const r = await execFileAsync(
      "pdflatex",
      ["-interaction=nonstopmode", `-output-directory=${outputDirAbs}`, texPathAbs],
      { maxBuffer: 10 * 1024 * 1024, encoding: "utf8" },
    );
    const stdout = String((r as { stdout?: unknown }).stdout ?? "");
    const stderr = String((r as { stderr?: unknown }).stderr ?? "");
    const log = `${stdout}\n${stderr}`.trim();
    return { ok: true, log };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const log = [err.stdout, err.stderr, err.message].filter(Boolean).join("\n");
    return { ok: false, log };
  }
}
