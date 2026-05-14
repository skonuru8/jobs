/**
 * run-folder.ts — helpers to name the per-run output directory under output/applications/.
 *
 * Layout:
 *   output/applications/{run_label}/{slug}/...
 *
 * Pipeline run label:  {ISO timestamp}_{run_id first 8}   e.g. 2026-05-14T10-30-15_9e27688e
 * Manual run label:    manual_{ISO timestamp}              e.g. manual_2026-05-15T09-15-30
 *
 * Colons are replaced with hyphens for filesystem safety.
 */

export function makeRunFolderName(runStartedAt: Date, runId: string): string {
  const iso = runStartedAt.toISOString().slice(0, 19).replace(/:/g, "-");
  const short = runId.slice(0, 8);
  return `${iso}_${short}`;
}

export function makeManualFolderName(generatedAt: Date): string {
  const iso = generatedAt.toISOString().slice(0, 19).replace(/:/g, "-");
  return `manual_${iso}`;
}
