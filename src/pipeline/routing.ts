/**
 * routing.ts — pure pre-judge routing decisions for a single job.
 */

export const MIN_USABLE_JD_CHARS = 200;

export type GateVerdict = "GATE_PASS" | "ARCHIVE" | "PASS";
export type ExtractStatus = "ok" | "error" | "skipped";

export function hasUsableDescription(descriptionRaw: string | null | undefined): boolean {
  return typeof descriptionRaw === "string"
    && descriptionRaw.trim().length >= MIN_USABLE_JD_CHARS;
}

export interface RoutingInput {
  doExtract: boolean;
  extractStatus: ExtractStatus;
  scored: boolean;
  gatePassed: boolean;
  isSemanticDuplicate: boolean;
}

export interface Routing {
  extractionFailed: boolean;
  gateVerdict: GateVerdict;
  isArchived: boolean;
  shouldJudge: boolean;
}

export function routeJob(i: RoutingInput): Routing {
  const extractionFailed = i.doExtract && i.extractStatus === "error";
  const gateVerdict: GateVerdict = extractionFailed
    ? "ARCHIVE"
    : i.scored
      ? (i.gatePassed ? "GATE_PASS" : "ARCHIVE")
      : "PASS";

  const isSemanticDup = gateVerdict === "GATE_PASS" && i.isSemanticDuplicate;
  const isArchived = gateVerdict === "ARCHIVE" || isSemanticDup;
  const shouldJudge = gateVerdict === "GATE_PASS" && !i.isSemanticDuplicate;

  return { extractionFailed, gateVerdict, isArchived, shouldJudge };
}
