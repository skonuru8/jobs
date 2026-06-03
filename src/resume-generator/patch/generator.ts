import * as crypto from "crypto";

import { complete } from "@/cover-letter/client";
import type { GapDirective, TechSwap } from "@/judge/types";
import { buildSlimJdForPrompts } from "@/shared/artifact-bundle";

import type { ResumeGenConfig, ResumeGenInput } from "../types";
import type { PatchOp, RoleBlock } from "./types";

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

export const PATCH_PROMPT_SHA = crypto
  .createHash("sha256")
  .update(PATCH_MODE_PROMPT, "utf8")
  .digest("hex")
  .slice(0, 12);

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

export function activeGapDirectives(directives: GapDirective[]): GapDirective[] {
  return directives.filter(d =>
    (d.handling === "fabricate" || d.handling === "reframe") && Boolean(d.target_role),
  );
}

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

function renderRoleBlock(block: RoleBlock): Record<string, unknown> {
  return {
    role: block.role,
    items: block.items.map(item => ({ item: item.index, text: item.text })),
  };
}

function renderTechSwaps(swaps: TechSwap[]): Array<Pick<TechSwap, "from" | "to" | "target_role">> {
  return swaps.map(s => ({ from: s.from, to: s.to, target_role: s.target_role }));
}

function parsePatchOps(content: string): PatchOp[] {
  const json = JSON.parse(stripFences(content));
  const raw = Array.isArray(json) ? json : json.ops;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isPatchOp);
}

function filterValidOps(ops: PatchOp[], roleBlocks: RoleBlock[]): PatchOp[] {
  return ops.filter(op => {
    const block = roleBlocks.find(b => sameRoleish(b.role, op.role));
    if (!block) return false;
    if (op.type === "rewrite") return op.item >= 1 && op.item <= block.items.length;
    if (op.type === "insert_after") return op.after_item >= 1 && op.after_item <= block.items.length;
    return true; // insert_first — role validated, no position constraint
  });
}

function isPatchOp(x: unknown): x is PatchOp {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.role !== "string") return false;
  if (o.type === "rewrite") return Number.isInteger(o.item) && typeof o.new_item === "string";
  if (o.type === "insert_after") return Number.isInteger(o.after_item) && typeof o.item === "string";
  if (o.type === "insert_first") return typeof o.item === "string";
  return false;
}

function sameRoleish(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function stripFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}
