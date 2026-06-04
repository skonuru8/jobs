/**
 * generator.ts — Patch-op planner prompt and LLM orchestration.
 *
 * Builds slim prompt context for patch mode, asks model for JSON ops only, and
 * validates returned operations against parsed role blocks before any mutation
 * reaches canonical TeX. Module exists to keep patch tailoring cheap and bounded
 * compared with full resume regeneration.
 *
 * Called by: patch orchestrator
 * Writes to: nothing
 * Side effects: one LLM call per attempt via `complete`
 */

import * as crypto from "crypto";

import { complete } from "@/cover-letter/client";
import type { GapDirective, TechSwap } from "@/judge/types";
import { buildSlimJdForPrompts } from "@/shared/artifact-bundle";

import type { ResumeGenConfig, ResumeGenInput } from "../types";
import type { PatchOp, RoleBlock } from "./types";

/**
 * System prompt for resume patch-planning mode.
 *
 * Constrains model to emit schema-valid JSON ops and forbids destructive or
 * out-of-scope edits so patch application can remain deterministic.
 */
export const PATCH_MODE_PROMPT = `
You are a resume patch planner. Return JSON only.

Output schema:
{"ops":[
  {"type":"insert_after","role":"...","after_item":1,"item":"\\\\item ..."},
  {"type":"rewrite","role":"...","item":1,"new_item":"\\\\item ..."},
  {"type":"insert_first","role":"...","item":"\\\\item ..."}
]}

Rules:
- Return only valid JSON. No markdown.
- Apply only fabricate and reframe directives.
- Never delete bullets.
- Never edit SUMMARY or SKILLS.
- Never invent metrics not present in the role block or directive.
- Keep every op scoped to the directive target_role.
- Use role names exactly as provided in ROLE_BLOCKS.
- If a directive cannot fit a role naturally, omit it.
`.trim();

/** Stable short hash for patch prompt versioning in artifacts and diagnostics. */
export const PATCH_PROMPT_SHA = crypto
  .createHash("sha256")
  .update(PATCH_MODE_PROMPT, "utf8")
  .digest("hex")
  .slice(0, 12);

/**
 * Requests validated patch ops from LLM for active fabricate/reframe directives.
 *
 * Returns deterministic noop metadata when no active directives exist so caller
 * can skip patch handling without branching on `null`. Raw model output is parsed
 * and filtered against current role blocks before leaving this function.
 *
 * @param input - Resume generation inputs, including directives and JD context.
 * @param config - Resume generation config supplying model and token limits.
 * @param roleBlocks - Parsed canonical role blocks available for mutation.
 * @param retryHint - Optional feedback listing directives missed in prior attempt.
 * @returns Validated patch ops plus model and token metadata for audit logging.
 * @throws {SyntaxError} When model returns invalid JSON and parse fails.
 * @throws {Error} Propagates `complete(...)` failures from underlying LLM client.
 */
export async function generatePatchOps(
  input: ResumeGenInput,
  config: ResumeGenConfig,
  roleBlocks: RoleBlock[],
  retryHint?: string,
): Promise<{ ops: PatchOp[]; model: string; tokens: { input: number; output: number } }> {
  const activeDirectives = activeGapDirectives(input.gap_directives ?? input.judge_json.gap_directives ?? []);
  if (activeDirectives.length === 0) {
    return { ops: [], model: "deterministic-noop", tokens: { input: 0, output: 0 } };
  }

  const r = await complete({
    model: config.model,
    messages: [
      { role: "system", content: PATCH_MODE_PROMPT },
      { role: "user", content: buildPatchUserMessage(input, roleBlocks, activeDirectives, retryHint) },
    ],
    max_tokens: Math.min(config.max_tokens, 1600),
    temperature: Math.min(config.temperature, 0.2),
  });

  return {
    ops: filterValidOps(parsePatchOps(r.content), roleBlocks),
    model: r.model,
    tokens: { input: r.input_tokens ?? 0, output: r.output_tokens ?? 0 },
  };
}

/**
 * Filters directives down to patch-eligible actions with concrete role targets.
 *
 * Patch mode only handles additive or reframing edits inside existing roles. Any
 * directive without `target_role` or with different handling is ignored here.
 *
 * @param directives - Raw gap directives from judge output.
 * @returns Directives safe to send into patch planner.
 */
export function activeGapDirectives(directives: GapDirective[]): GapDirective[] {
  return directives.filter(d =>
    (d.handling === "fabricate" || d.handling === "reframe") && Boolean(d.target_role),
  );
}

/**
 * Builds compact user prompt payload for patch planner.
 *
 * Only role blocks relevant to targeted directives are included so prompt cost
 * stays low and planner cannot drift into unrelated resume sections.
 *
 * @param input - Resume generation inputs containing JD and optional tech swaps.
 * @param roleBlocks - Parsed canonical role blocks from EXPERIENCE section.
 * @param directives - Patch-eligible directives for this attempt.
 * @param retryHint - Optional miss feedback from prior coverage failure.
 * @returns Serialized prompt body consumed by `PATCH_MODE_PROMPT`.
 */
function buildPatchUserMessage(
  input: ResumeGenInput,
  roleBlocks: RoleBlock[],
  directives: GapDirective[],
  retryHint?: string,
): string {
  const targetRoles = new Set(directives.map(d => d.target_role).filter(Boolean) as string[]);
  const relevantBlocks = roleBlocks.filter(b =>
    [...targetRoles].some(role => sameRoleish(b.role, role)),
  );
  const techSwaps = input.tech_swaps ?? input.judge_json.tailoring_hints?.tech_swaps ?? [];

  const parts = [
    "DIRECTIVES:",
    JSON.stringify(directives, null, 2),
    "",
    "ROLE_BLOCKS:",
    JSON.stringify(relevantBlocks.map(renderRoleBlock), null, 2),
    "",
    "SLIM_JD:",
    JSON.stringify(buildSlimJdForPrompts(input.jd_json), null, 2),
    "",
    "TECH_SWAPS:",
    JSON.stringify(renderTechSwaps(techSwaps), null, 2),
  ];
  if (retryHint) parts.push("", "RETRY_HINT:", retryHint);
  return parts.join("\n");
}

/**
 * Shrinks role block down to planner-facing shape.
 *
 * @param block - Parsed canonical role block.
 * @returns Plain object containing role label and numbered bullets only.
 */
function renderRoleBlock(block: RoleBlock): Record<string, unknown> {
  return {
    role: block.role,
    items: block.items.map(item => ({ item: item.index, text: item.text })),
  };
}

/**
 * Drops tech swap details patch planner does not need.
 *
 * @param swaps - Tech swap hints from judge/tailoring stage.
 * @returns Minimal tech-swap records relevant to targeted role rewrites.
 */
function renderTechSwaps(swaps: TechSwap[]): Array<Pick<TechSwap, "from" | "to" | "target_role">> {
  return swaps.map(s => ({ from: s.from, to: s.to, target_role: s.target_role }));
}

/**
 * Parses JSON patch response and keeps only shape-valid ops.
 *
 * Accepts either top-level array or `{ ops: [...] }` wrapper because models may
 * vary slightly while still honoring prompt intent.
 *
 * @param content - Raw model response text.
 * @returns Shape-valid patch ops, possibly empty when schema is absent.
 * @throws {SyntaxError} When response body is not valid JSON after fence stripping.
 */
function parsePatchOps(content: string): PatchOp[] {
  const json = JSON.parse(stripFences(content));
  const raw = Array.isArray(json) ? json : json.ops;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isPatchOp);
}

/**
 * Rejects ops that target missing roles or invalid bullet indexes.
 *
 * This is last guardrail before mutation reaches canonical TeX. Planner may
 * return syntactically valid JSON that still points at impossible locations.
 *
 * @param ops - Shape-valid ops parsed from model response.
 * @param roleBlocks - Parsed canonical role blocks available for mutation.
 * @returns Ops whose role and positional references are safe to apply.
 */
function filterValidOps(ops: PatchOp[], roleBlocks: RoleBlock[]): PatchOp[] {
  const available = roleBlocks.map(b => b.role).join(", ");
  return ops.filter(op => {
    const block = roleBlocks.find(b => sameRoleish(b.role, op.role));
    if (!block) {
      console.warn(`[patch] filterValidOps: dropped — role "${op.role}" not in [${available}]`);
      return false;
    }
    if (op.type === "rewrite" && !(op.item >= 1 && op.item <= block.items.length)) {
      console.warn(`[patch] filterValidOps: dropped rewrite — item ${op.item} OOB in "${op.role}" (${block.items.length} items)`);
      return false;
    }
    if (op.type === "insert_after" && !(op.after_item >= 1 && op.after_item <= block.items.length)) {
      console.warn(`[patch] filterValidOps: dropped insert_after — after_item ${op.after_item} OOB in "${op.role}" (${block.items.length} items)`);
      return false;
    }
    return true;
  });
}

/**
 * Runtime type guard for patch-op union.
 *
 * @param x - Unknown JSON value from model response.
 * @returns `true` when value satisfies one supported `PatchOp` variant.
 */
function isPatchOp(x: unknown): x is PatchOp {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.role !== "string") return false;
  if (o.type === "rewrite") return Number.isInteger(o.item) && typeof o.new_item === "string";
  if (o.type === "insert_after") return Number.isInteger(o.after_item) && typeof o.item === "string";
  if (o.type === "insert_first") return typeof o.item === "string";
  return false;
}

/**
 * Performs tolerant role matching between planner output and canonical blocks.
 *
 * @param a - Canonical role label.
 * @param b - Planner or directive role label.
 * @returns `true` when normalized strings match or one contains other.
 */
function sameRoleish(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  return na === nb ||
    (na.length >= 5 && nb.length >= 5 && (na.includes(nb) || nb.includes(na)));
}

/**
 * Canonicalizes role text for fuzzy equality checks.
 *
 * @param s - Raw role string.
 * @returns Lowercased alphanumeric token string with punctuation collapsed.
 */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Removes Markdown code fences around model JSON when present.
 *
 * @param s - Raw model response text.
 * @returns Fence-free JSON string suitable for `JSON.parse`.
 */
function stripFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}
