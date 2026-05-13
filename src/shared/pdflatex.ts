/**
 * Run pdflatex once (nonstopmode). Returns combined log on failure.
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface PdflatexResult {
  ok: boolean;
  log: string;
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

/** True if pdflatex log looks like a successful run (PDF written). */
export function pdflatexLogSuggestsSuccess(log: string): boolean {
  return !/Fatal error|Emergency stop|! LaTeX Error|No pages of output/i.test(log);
}
