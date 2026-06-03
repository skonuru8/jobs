/**
 * run-folder.ts — helpers to name the per-run output directory under output/applications/.
 *
 * Layout:
 *   output/applications/{YYYY-MM-DD}/{run_label}/{slug}/...
 *
 * Pipeline run label:  {ISO timestamp}_{run_id first 8}   e.g. 2026-05-14T10-30-15_9e27688e
 * Manual run label:    manual_{ISO timestamp}              e.g. manual_2026-05-15T09-15-30
 *
 * Colons are replaced with hyphens for filesystem safety.
 *
 * Called by: artifact generation + manual export flows
 * Writes to: nothing
 * Side effects: none
 */

/**
 * Derives stable day bucket used as first directory segment for application exports.
 *
 * @param date - Source timestamp for run or manual generation.
 * @returns UTC calendar date in `YYYY-MM-DD` format.
 */
export function makeDateFolderName(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Builds canonical pipeline run label from run start time and run id prefix.
 *
 * @param runStartedAt - Timestamp captured when pipeline run began.
 * @param runId - Full run identifier; first 8 characters are embedded for traceability.
 * @returns Filesystem-safe label like `2026-05-14T10-30-15_9e27688e`.
 */
export function makeRunLabel(runStartedAt: Date, runId: string): string {
  const iso = runStartedAt.toISOString().slice(0, 19).replace(/:/g, "-");
  const short = runId.slice(0, 8);
  return `${iso}_${short}`;
}

/**
 * Combines date bucket and run label into relative folder path for pipeline output.
 *
 * @param runStartedAt - Timestamp captured when pipeline run began.
 * @param runId - Full run identifier used to derive short label suffix.
 * @returns Relative folder path under `output/applications/`.
 */
export function makeRunFolderName(runStartedAt: Date, runId: string): string {
  return `${makeDateFolderName(runStartedAt)}/${makeRunLabel(runStartedAt, runId)}`;
}

/**
 * Builds label for manually generated artifacts that are not tied to orchestrated run ids.
 *
 * @param generatedAt - Timestamp when manual export occurred.
 * @returns Filesystem-safe label like `manual_2026-05-15T09-15-30`.
 */
export function makeManualRunLabel(generatedAt: Date): string {
  const iso = generatedAt.toISOString().slice(0, 19).replace(/:/g, "-");
  return `manual_${iso}`;
}

/**
 * Combines date bucket and manual label into relative folder path for ad-hoc exports.
 *
 * @param generatedAt - Timestamp when manual export occurred.
 * @returns Relative folder path under `output/applications/`.
 */
export function makeManualFolderName(generatedAt: Date): string {
  return `${makeDateFolderName(generatedAt)}/${makeManualRunLabel(generatedAt)}`;
}
