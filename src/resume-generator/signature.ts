/**
 * signature.ts — Stable identity for tailored resume generations.
 *
 * Combines canonical resume input, judge-driven tailoring directives, and
 * prompt selection into deterministic hashes so downstream code can detect
 * when a prior artifact is safe to reuse.
 *
 * Called by: resume-cache.ts, resume persistence flows
 * Side effects: computes SHA-256 digests in memory only
 */
import * as crypto from "crypto";

import type { ArtifactBundleOk } from "@/shared/artifact-bundle";

import { PATCH_PROMPT_SHA, PATCH_TOTAL_PROMPT_SHA } from "./patch/generator";
import { PROMPT_SHA } from "./prompt";
import type { ResumeGenConfig, ResumeMode } from "./types";

export interface ResumeSignature {
  /** SHA of canonical resume source that tailoring starts from. */
  canonical_sha: string;
  /** Stable hash of judge-issued gap directives that drive resume edits. */
  directives_hash: string;
  /** Stable hash of tech-equivalence swaps applied during tailoring. */
  tech_swaps_hash: string;
  /** Prompt version hash for full regeneration or patch-tailoring mode. */
  prompt_sha: string;
  /** Generation strategy that chose the prompt and output path. */
  resume_mode: ResumeMode;
}

/**
 * Builds cache key material for a resume generation attempt.
 *
 * Hashing directive payloads separately lets cache lookup reject stale
 * artifacts when intent changes even if canonical resume input stays same.
 *
 * @param bundle - Validated artifact bundle containing canonical resume and judge output.
 * @param config - Resume generator config whose mode selects prompt lineage.
 * @returns Deterministic signature fields suitable for persistence and cache checks.
 */
export function buildResumeSignature(bundle: ArtifactBundleOk, config: ResumeGenConfig): ResumeSignature {
  const resume_mode = config.mode ?? "patch_tailoring";
  const hints = bundle.judge_json.tailoring_hints;
  // FIX-11: hash all tailoring hint fields so changes to any field invalidate cache
  const directivesPayload = {
    gap_directives:      bundle.judge_json.gap_directives ?? [],
    emphasize_roles:     hints?.emphasize_roles ?? [],
    emphasize_skills:    hints?.emphasize_skills ?? [],
    downplay_skills:     hints?.downplay_skills ?? [],
    domain_reframe_angle: hints?.domain_reframe_angle ?? null,
  };
  return {
    canonical_sha: bundle.canonical_sha,
    directives_hash: stableHash(directivesPayload),
    tech_swaps_hash: stableHash(hints?.tech_swaps ?? []),
    prompt_sha: resume_mode === "patch_tailoring" ? PATCH_PROMPT_SHA
              : resume_mode === "patch_total"     ? PATCH_TOTAL_PROMPT_SHA
              : PROMPT_SHA,
    resume_mode,
  };
}

/**
 * Extracts signature fields that belong in artifact metadata payloads.
 *
 * Keeps runtime metadata compact by omitting fields already stored on artifact
 * rows while preserving mode- and directive-level cache invalidation context.
 *
 * @param signature - Full resume signature generated for current artifact attempt.
 * @returns Metadata-safe subset merged into persisted artifact records.
 */
export function signatureMeta(signature: ResumeSignature): Record<string, unknown> {
  return {
    resume_mode: signature.resume_mode,
    directives_hash: signature.directives_hash,
    tech_swaps_hash: signature.tech_swaps_hash,
  };
}

/**
 * Produces stable short hash for nested JSON-like values.
 *
 * Object keys are sorted first so semantically identical payloads hash the
 * same even when property insertion order differs between producers.
 *
 * @param value - Arbitrary JSON-like payload to canonicalize and hash.
 * @returns First 12 hex characters of SHA-256 digest.
 */
function stableHash(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(sortValue(value)), "utf8")
    .digest("hex")
    .slice(0, 12);
}

/**
 * Recursively sorts object keys before hashing structured payloads.
 *
 * Arrays preserve order because directive order is meaningful; only object
 * field order is normalized away.
 *
 * @param value - Arbitrary value from directive or tech-swap payloads.
 * @returns Equivalent value with nested object keys sorted lexicographically.
 */
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, sortValue(v)]),
  );
}
