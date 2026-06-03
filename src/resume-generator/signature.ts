import * as crypto from "crypto";

import type { ArtifactBundleOk } from "@/shared/artifact-bundle";

import { PATCH_PROMPT_SHA } from "./patch/generator";
import { PROMPT_SHA } from "./prompt";
import type { ResumeGenConfig, ResumeMode } from "./types";

export interface ResumeSignature {
  canonical_sha: string;
  directives_hash: string;
  tech_swaps_hash: string;
  prompt_sha: string;
  resume_mode: ResumeMode;
}

export function buildResumeSignature(bundle: ArtifactBundleOk, config: ResumeGenConfig): ResumeSignature {
  const resume_mode = config.mode ?? "patch_tailoring";
  return {
    canonical_sha: bundle.canonical_sha,
    directives_hash: stableHash(bundle.judge_json.gap_directives ?? []),
    tech_swaps_hash: stableHash(bundle.judge_json.tailoring_hints?.tech_swaps ?? []),
    prompt_sha: resume_mode === "patch_tailoring" ? PATCH_PROMPT_SHA : PROMPT_SHA,
    resume_mode,
  };
}

export function signatureMeta(signature: ResumeSignature): Record<string, unknown> {
  return {
    resume_mode: signature.resume_mode,
    directives_hash: signature.directives_hash,
    tech_swaps_hash: signature.tech_swaps_hash,
  };
}

function stableHash(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(sortValue(value)), "utf8")
    .digest("hex")
    .slice(0, 12);
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, sortValue(v)]),
  );
}
