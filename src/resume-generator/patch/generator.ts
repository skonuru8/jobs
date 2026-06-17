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

RULES:

OP COUNT HARD LIMITS — check these BEFORE writing any ops:
- TOTAL ops: never more than 8. Count as you go and stop when you hit 8.
- PER-ROLE rewrite cap: at most 2 rewrite ops per role. Once a role has 2 rewrites, skip ALL further rewrites for it — even if more emphasis_skills remain.
- PRIORITY ORDER: (1) directive ops (fabricate/reframe) first, (2) emphasis ops fill remaining slots. If you've used 6 slots on directives and the cap is 8, only 2 emphasis slots remain.
- At most ONE op per (role, item) slot. If two directives target the same bullet, keep only the most important one.
- Every insert_after and insert_first op MUST have a non-empty new bullet string. Never emit an op with an empty item.

Core:
- Return only valid JSON. No markdown.
- Apply fabricate and reframe directives AND EMPHASIS_ROLES rewrites.
- Never delete bullets.
- Never edit SUMMARY or SKILLS.
- Keep every op scoped to the directive target_role or an EMPHASIS_ROLES role.
- Use role names exactly as provided in ROLE_BLOCKS.
- frame_as is briefing guidance only — extract the factual content, do NOT copy its phrasing verbatim into bullets.
- Write bullets as confident factual statements about what the candidate did. No hedging.

Fabrication guard — NO INVENTION:
- Never invent metrics (numbers, percentages, counts) not present in the role block or directive.
- Never invent tools, libraries, or technologies not explicitly named in the role block or the directive's frame_as. Do not add a technology because it sounds plausible — only include it if the source material names it.

Fact preservation — NO SUBSTITUTION:
- You may ONLY add content alongside what exists. You may NEVER replace a named technology, system, client, domain, or noun phrase with a different one.
  Wrong: original says "PostgreSQL" → rewrite says "MySQL". Wrong: original says "batch ETL pipeline" → rewrite says "streaming pipeline".
- This applies to ALL op types (fabricate, reframe, emphasis). Adding is allowed; swapping is not.

REFRAME directive — concrete bridging, not keyword stuffing:
- A reframe MUST add a specific, verifiable mechanism, activity, or result that demonstrates the adjacent competence. Ask: what did the candidate actually BUILD or DO?
- Appending a bare skill name or a trailing clause like "demonstrating X patterns" / "applicable to Y" / "aligning with Z requirements" / "patterns that align with Kafka" is keyword stuffing — it is NOT a reframe and will be rejected.
- If no concrete adjacent activity exists in the role block, omit the op rather than stuffing a keyword.
- Cap at one new clause per rewrite. Do not merge multiple gaps into one run-on sentence.

Context-aware keyword injection:
- Do not bold or inject a backend language (e.g. Java, Python) into a bullet whose context already establishes it, or into a frontend-only bullet (UI dashboards, Angular forms, styling). Adding "Java" to a Java/Spring-Boot project bullet is zero signal.
- Do not attribute a technology to a role/project unless it is in that role's bullets or frame_as. A skill listed in the SKILLS section is not evidence of project-level use.

EMPHASIS pass — injection only, strict eligibility required:

ELIGIBILITY CHECK — run this for EACH bullet before writing an emphasis op:
  Step 1: Does the emphasis_skill word already appear anywhere in the bullet text (bolded or unbolded)?
          If YES → this bullet is INELIGIBLE. Skip it. Do NOT bold a word that is already present.
  Step 2: Is this a frontend-only bullet (UI, forms, dashboard, styling, Angular templates) and the emphasis_skill a backend language (Java, Python, Go)?
          If YES → INELIGIBLE. Do not cross-pollinate frontend bullets with backend language names.
  Step 3: Would the rewrite add ONLY the skill name with no accompanying new mechanism, technique, system, or scope?
          Example: "Built Spring Boot microservices" → "Built Java Spring Boot microservices" is INELIGIBLE.
          Example: "Built Spring Boot microservices" → "Built Spring Boot microservices using Java Stream API for parallel transformation of 50M records" is ELIGIBLE.
          If only the name would be added → INELIGIBLE.
  Step 4: If the role has already hit its 2-rewrite cap → all bullets in that role are INELIGIBLE.

If all bullets in a role fail eligibility, emit ZERO emphasis ops for that role — do NOT force an ineligible op just to have something.

When a bullet IS eligible:
- Preserve EVERY factual claim, named object, scope qualifier, and contextual phrase from the original VERBATIM.
- Only permitted changes: (a) wrapping or inserting EMPHASIS_SKILLS terms in \\textbf{...}, (b) adding a short tech-stack clause that names the skill with a specific mechanism, (c) minimal connective words to stay grammatical.
- Do NOT generalize or abstract. Do NOT replace a concrete noun with a generic category. Do NOT drop named systems, counts, or metrics.
- Verify: every specific phrase from the original still appears in the rewrite.
- Do NOT add new bullets. Do NOT invent metrics.

BANNED phrases — NEVER use any of these in any bullet text:
${BANNED_STYLE_PHRASE_STRINGS.map(p => `  "${p}"`).join("\n")}

Banned generative-stuffing patterns (match by intent, not exact string):
- Any trailing clause of the form "…demonstrating {skill} patterns" / "…applicable to {requirement}" / "…aligning with {jd_term}" / "…patterns that align with {tool}" when the rest of the bullet is unchanged.
- Rewrite to state the actual fact directly instead.

Wrong:  "\\\\item Built event-driven pipelines directly applicable to AI agent architectures."
Right:  "\\\\item Built event-driven pipelines processing \\\\textbf{100k+} events/sec using \\\\textbf{AWS Kinesis} and \\\\textbf{Lambda}, with schema validation and dead-letter routing."

EXAMPLES:

Example 1 — fabricate: add a new container observability bullet
DIRECTIVE:
{"jd_requirement":"Kubernetes health monitoring","handling":"fabricate","target_role":"Payments Service","frame_as":"The candidate ran 8 Spring Boot microservices on AWS ECS. They automated deployments and coordinated health-check and rollback procedures with the DevOps team. Surface container lifecycle ownership and health-check responsibility."}
ROLE_BLOCKS (excerpt):
{"role":"Payments Service","items":[{"item":5,"text":"\\\\item Automated deployment pipelines using \\\\textbf{Docker} and \\\\textbf{AWS ECS}, coordinating rollback procedures with the DevOps team across a multi-service production environment."}]}
CORRECT OP:
{"ops":[{"type":"rewrite","role":"Payments Service","item":5,"new_item":"\\\\item Owned deployment automation for \\\\textbf{8 Spring Boot microservices} using \\\\textbf{Docker} and \\\\textbf{AWS ECS}, defining container health checks, rolling-update strategies, and incident rollback procedures to maintain availability during production releases."}]}

Example 2 — reframe: surface query-tuning experience for a database performance gap
DIRECTIVE:
{"jd_requirement":"SQL query optimization","handling":"reframe","target_role":"Analytics Platform","frame_as":"The candidate wrote complex PostgreSQL queries for reporting dashboards that cut report generation time by 20%. Surface the tuning methodology and the measurable outcome."}
ROLE_BLOCKS (excerpt):
{"role":"Analytics Platform","items":[{"item":4,"text":"\\\\item Wrote complex \\\\textbf{PostgreSQL} queries for client-facing analytics reports, reducing generation time by \\\\textbf{20\\\\%} and enabling real-time pipeline metric visibility."}]}
CORRECT OP:
{"ops":[{"type":"rewrite","role":"Analytics Platform","item":4,"new_item":"\\\\item Tuned \\\\textbf{PostgreSQL} queries for client-facing analytics dashboards using index strategy, query-plan analysis, and result-set caching, achieving a \\\\textbf{20\\\\%} reduction in report generation time and enabling real-time pipeline metric visibility."}]}

REFRAME WRONG vs RIGHT — keyword stuffing vs concrete bridging:
JD requirement: "Apache Kafka / event streaming"
WRONG (appended keyword clause — adds nothing concrete, banned pattern):
  "\\\\item Processed payment events using \\\\textbf{AWS SQS}, implementing messaging patterns that align with Kafka-style event-driven architectures."
RIGHT (names the actual mechanism with scale and delivery guarantees — demonstrates the adjacent competence):
  "\\\\item Designed a payment event pipeline using \\\\textbf{AWS SQS} with \\\\textbf{SNS} fan-out, dead-letter queues, and at-least-once delivery guarantees, routing events across \\\\textbf{5 downstream services} with schema validation at ingestion."

Example 3 — emphasis: inject missing skill terms into an existing bullet
DIRECTIVES: []
EMPHASIS_ROLES: ["Operations Team"]
EMPHASIS_SKILLS: ["React", "TypeScript", "REST APIs"]
ROLE_BLOCKS (excerpt):
{"role":"Operations Team","items":[{"item":1,"text":"\\\\item Built a customer-facing scheduling portal for job tracking and dispatch management, replacing a manual spreadsheet workflow used by 200+ field coordinators."}]}
CORRECT OP:
{"ops":[{"type":"rewrite","role":"Operations Team","item":1,"new_item":"\\\\item Built a customer-facing \\\\textbf{React + TypeScript} scheduling portal for job tracking and dispatch management, backed by \\\\textbf{REST APIs}, used by 200+ field coordinators and replacing a manual spreadsheet workflow."}]}

EMPHASIS WRONG vs RIGHT — injection only, no context removal:
Original: "\\\\item Refactored legacy billing forms for manual invoice creation, decoupling tightly coupled modules across a monolithic codebase and resolving \\\\textbf{40+} defects, cutting error reports by \\\\textbf{12\\\\%} over two release cycles."
EMPHASIS_SKILLS: ["Vue.js", "JavaScript"]
WRONG (drops "forms for manual invoice creation" and "monolithic codebase" — unacceptable context removal):
  "\\\\item Refactored component-based frontend architecture using \\\\textbf{Vue.js} and \\\\textbf{JavaScript}, decoupling tightly coupled modules and resolving \\\\textbf{40+} defects, cutting error reports by \\\\textbf{12\\\\%} over two release cycles."
RIGHT (every original phrase kept; "and \\\\textbf{JavaScript}" injected alongside the existing stack):
  "\\\\item Refactored legacy \\\\textbf{Vue.js} and \\\\textbf{JavaScript} billing forms for manual invoice creation, decoupling tightly coupled modules across a monolithic codebase and resolving \\\\textbf{40+} defects, cutting error reports by \\\\textbf{12\\\\%} over two release cycles."
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
  modelOverride?: string,
): Promise<{ ops: PatchOp[]; model: string; tokens: { input: number; output: number }; ops_dropped_unknown_role: number }> {
  const activeDirectives = activeGapDirectives(input.gap_directives ?? input.judge_json.gap_directives ?? []);
  const emphRoles = emphasisRoles(input);
  if (activeDirectives.length === 0 && emphRoles.length === 0) {
    return { ops: [], model: "deterministic-noop", tokens: { input: 0, output: 0 }, ops_dropped_unknown_role: 0 };
  }

  const model = modelOverride ?? config.model;

  const patchMessages = [
    { role: "system" as const, content: PATCH_MODE_PROMPT },
    { role: "user" as const, content: buildPatchUserMessage(input, roleBlocks, activeDirectives, retryHint, emphRoles) },
  ];
  const patchOpts = {
    max_tokens: config.patch_max_tokens ?? config.max_tokens,
    temperature: Math.min(config.temperature, 0.2),
  };

  const r = await complete({ model, messages: patchMessages, ...patchOpts });

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
  return (input.judge_json.tailoring_hints?.emphasize_roles ?? []).slice(0, 2);
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
    const emphSkills = (input.judge_json.tailoring_hints?.emphasize_skills ?? []).slice(0, 5);
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
