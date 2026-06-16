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
import { BANNED_STYLE_PHRASE_STRINGS } from "@/shared/style-lint";

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
- Apply fabricate and reframe directives AND EMPHASIS_ROLES rewrites.
- Never delete bullets.
- Never edit SUMMARY or SKILLS.
- Never invent metrics not present in the role block or directive.
- Keep every op scoped to the directive target_role or an EMPHASIS_ROLES role.
- Use role names exactly as provided in ROLE_BLOCKS.
- If a directive cannot fit a role naturally, omit it.
- frame_as is briefing guidance only — extract the factual content, do NOT copy its phrasing verbatim into bullets.
- Write bullets as confident factual statements about what the candidate did. No hedging.
- EMPHASIS pass: when EMPHASIS_ROLES is present, rewrite 1–2 existing bullets per listed role to foreground the skills in EMPHASIS_SKILLS. Select bullets that already touch those skills or closely adjacent work — reshape language to put the EMPHASIS_SKILLS terms front and center. Do NOT add new bullets, do NOT invent metrics — only reshape existing bullet text. Emit these as "rewrite" ops alongside any directive ops.

BANNED phrases — NEVER use any of these in any bullet text:
${BANNED_STYLE_PHRASE_STRINGS.map(p => `  "${p}"`).join("\n")}

If a bullet you would write contains one of these phrases, rewrite it to state the fact directly without the bridge phrase.
Wrong:  "\\\\item Built event-driven pipelines directly applicable to AI agent architectures."
Right:  "\\\\item Built event-driven pipelines processing 100k+ events/sec using AWS Kinesis and Lambda."

EXAMPLES:

Example 1 — fabricate: add Kubernetes observability bullet to Project: Nokia
DIRECTIVE:
{"jd_requirement":"container orchestration observability","handling":"fabricate","target_role":"Project: Nokia","frame_as":"Nokia CPQ ran 10+ Spring Boot microservices on Azure with Docker and Kubernetes via Azure Pipelines. Candidate contributed to containerization and deployment orchestration. Surface container monitoring and health-check ownership."}
ROLE_BLOCKS (excerpt):
{"role":"Project: Nokia","items":[{"item":8,"text":"\\\\item Contributed to containerization and deployment orchestration with \\\\textbf{Docker, Kubernetes, and Azure Pipelines} alongside the DevOps team across a large-scale Azure environment."}]}
CORRECT OP:
{"ops":[{"type":"rewrite","role":"Project: Nokia","item":8,"new_item":"\\\\item Owned containerization and deployment orchestration for \\\\textbf{10+ Spring Boot microservices} using \\\\textbf{Docker, Kubernetes, and Azure Pipelines}, monitoring health checks and scaling behavior across the Nokia CPQ Azure environment."}]}

Example 2 — reframe: surface SQL query optimization at Project: PHIA
DIRECTIVE:
{"jd_requirement":"database query performance tuning","handling":"reframe","target_role":"Project: PHIA","frame_as":"PHIA PATS ran on SQL Server. Candidate wrote optimized queries that improved report generation by 15%. Surface the optimization work and the measurable outcome."}
ROLE_BLOCKS (excerpt):
{"role":"Project: PHIA","items":[{"item":6,"text":"\\\\item Wrote optimized \\\\textbf{SQL Server} queries for client-facing task-listing reports, improving generation times by \\\\textbf{15\\\\%} and enabling real-time queue visibility for PHIA Group clients."}]}
CORRECT OP:
{"ops":[{"type":"rewrite","role":"Project: PHIA","item":6,"new_item":"\\\\item Tuned \\\\textbf{SQL Server} queries for client-facing task-listing and reporting workflows, achieving \\\\textbf{15\\\\%} faster generation times and enabling real-time queue visibility for PHIA Group stakeholders."}]}

Example 3 — emphasis: rewrite AquilaEdge LLC bullet to foreground React + TypeScript for an AI startup JD
DIRECTIVES: []
EMPHASIS_ROLES: ["AquilaEdge LLC"]
EMPHASIS_SKILLS: ["React", "TypeScript", "REST APIs", "Node.js"]
ROLE_BLOCKS (excerpt):
{"role":"AquilaEdge LLC","items":[{"item":1,"text":"\\\\item Architected and delivered a customer-facing web portal for scheduling and job tracking, replacing a manual spreadsheet workflow used by 50+ field service teams."}]}
CORRECT OP:
{"ops":[{"type":"rewrite","role":"AquilaEdge LLC","item":1,"new_item":"\\\\item Architected and delivered a customer-facing \\\\textbf{React + TypeScript} portal for scheduling and job tracking, exposing \\\\textbf{REST APIs} consumed by 50+ field service teams and replacing a manual spreadsheet workflow."}]}
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
): Promise<{ ops: PatchOp[]; model: string; tokens: { input: number; output: number }; ops_dropped_unknown_role: number }> {
  const activeDirectives = activeGapDirectives(input.gap_directives ?? input.judge_json.gap_directives ?? []);
  const emphRoles = emphasisRoles(input);
  if (activeDirectives.length === 0 && emphRoles.length === 0) {
    return { ops: [], model: "deterministic-noop", tokens: { input: 0, output: 0 }, ops_dropped_unknown_role: 0 };
  }

  const usePremium = config.premium_model
    && input.judge_json.verdict === "STRONG"
    && input.score.total >= (config.premium_min_score ?? 0.70);
  const model = usePremium ? config.premium_model! : config.model;

  const patchMessages = [
    { role: "system" as const, content: PATCH_MODE_PROMPT },
    { role: "user" as const, content: buildPatchUserMessage(input, roleBlocks, activeDirectives, retryHint, emphRoles) },
  ];
  // Cap at 6000: complex jobs (3 directives + emphasis) consume ~2500-3200 tokens
  // in DeepSeek reasoning before emitting JSON — 3200 caused finish_reason=length
  // on those jobs, producing empty content. 6000 gives enough headroom for both.
  const patchOpts = {
    max_tokens: Math.min(config.max_tokens, 6000),
    temperature: Math.min(config.temperature, 0.2),
  };

  let r;
  try {
    r = await complete({ model, messages: patchMessages, ...patchOpts });
  } catch (e) {
    if (!usePremium) throw e;
    // Premium failure: fall back to config.model once
    r = await complete({ model: config.model, messages: patchMessages, ...patchOpts });
  }

  const parsed = parsePatchOps(r.content);
  const ops = filterValidOps(parsed, roleBlocks);
  const ops_dropped_unknown_role = parsed.filter(op =>
    !roleBlocks.some(b => sameRole(b.role, op.role)),
  ).length;

  return {
    ops,
    model: r.model,
    tokens: { input: r.input_tokens ?? 0, output: r.output_tokens ?? 0 },
    ops_dropped_unknown_role,
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
 * Returns emphasis roles from judge tailoring hints.
 *
 * Non-empty list means judge identified roles whose existing bullets should be
 * rewritten to foreground the JD's key skills — the primary signal for STRONG
 * jobs that have no gap directives.
 *
 * @param input - Resume generation inputs.
 * @returns Array of exact role strings to emphasize; empty when not set.
 */
export function emphasisRoles(input: ResumeGenInput): string[] {
  return input.judge_json.tailoring_hints?.emphasize_roles ?? [];
}

/**
 * Builds compact user prompt payload for patch planner.
 *
 * Directive-target role blocks are always included. When emphRoles is non-empty
 * (STRONG/MAYBE jobs with no gap directives or in addition to directives), the
 * emphasis role blocks plus EMPHASIS_ROLES/EMPHASIS_SKILLS sections are appended
 * so the planner can generate targeted rewrites of existing bullets.
 *
 * @param input - Resume generation inputs containing JD and optional tech swaps.
 * @param roleBlocks - Parsed canonical role blocks from EXPERIENCE section.
 * @param directives - Patch-eligible directives for this attempt.
 * @param retryHint - Optional miss feedback from prior coverage failure.
 * @param emphRoles - Roles from judge tailoring_hints.emphasize_roles.
 * @returns Serialized prompt body consumed by `PATCH_MODE_PROMPT`.
 */
function buildPatchUserMessage(
  input: ResumeGenInput,
  roleBlocks: RoleBlock[],
  directives: GapDirective[],
  retryHint?: string,
  emphRoles: string[] = [],
): string {
  const targetRoles = new Set(directives.map(d => d.target_role).filter(Boolean) as string[]);
  const directiveBlocks = roleBlocks.filter(b =>
    [...targetRoles].some(role => sameRole(b.role, role)),
  );
  // Emphasis blocks: roles from emphasize_roles not already covered by directives
  const emphasisBlocks = emphRoles.length > 0
    ? roleBlocks.filter(b =>
        emphRoles.some(r => sameRole(b.role, r)) &&
        !directiveBlocks.some(db => sameRole(db.role, b.role)),
      )
    : [];
  const techSwaps = input.tech_swaps ?? input.judge_json.tailoring_hints?.tech_swaps ?? [];

  const parts = [
    "DIRECTIVES:",
    JSON.stringify(directives, null, 2),
    "",
    "ROLE_BLOCKS:",
    JSON.stringify([...directiveBlocks, ...emphasisBlocks].map(renderRoleBlock), null, 2),
    "",
    "SLIM_JD:",
    JSON.stringify(buildSlimJdForPrompts(input.jd_json), null, 2),
    "",
    "TECH_SWAPS:",
    JSON.stringify(renderTechSwaps(techSwaps), null, 2),
  ];
  if (emphRoles.length > 0) {
    const emphSkills = input.judge_json.tailoring_hints?.emphasize_skills ?? [];
    parts.push("", "EMPHASIS_ROLES:", JSON.stringify(emphRoles));
    parts.push("", "EMPHASIS_SKILLS:", JSON.stringify(emphSkills));
  }
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
    const block = roleBlocks.find(b => sameRole(b.role, op.role));
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
 * Exact normalized role equality between planner output and canonical blocks.
 *
 * @param a - Canonical role label.
 * @param b - Planner or directive role label.
 * @returns `true` when normalized strings are identical.
 */
function sameRole(a: string, b: string): boolean {
  return normalize(a) === normalize(b);
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
