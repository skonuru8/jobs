/**
 * apply.ts — Deterministic patch-op applier for canonical resume TeX.
 *
 * Replays validated patch ops against canonical source, re-parsing role blocks
 * before each mutation so byte offsets stay correct after prior insertions or
 * rewrites. Module never invents structure; it only splices bullet text inside
 * existing parsed role blocks.
 *
 * Called by: patch orchestrator
 * Writes to: nothing
 * Side effects: none
 */

import { extractRoleBlocks, findRoleBlock } from "./parser";
import type { PatchOp } from "./types";

/**
 * Applies validated patch ops to canonical resume LaTeX.
 *
 * Function always starts from canonical source and re-parses after each op so
 * earlier splices cannot corrupt later byte offsets. Missing roles or missing
 * target bullets are skipped rather than throwing because planner output is
 * best-effort and validation may still allow roleish mismatches.
 *
 * @param canonicalTex - Pristine canonical resume LaTeX to mutate.
 * @param ops - Validated patch ops in desired application order.
 * @returns Patched LaTeX string after all applicable ops are spliced in.
 */
export function applyPatchOps(canonicalTex: string, ops: PatchOp[]): string {
  let tex = canonicalTex;
  // Sort: rewrites first (no index shift), then inserts bottom-to-top (prevents upward drift).
  // Bottom-to-top also preserves insertion order for same-anchor ops.
  const sortedOps = [...ops].sort((a, b) => {
    const aRank = a.type === "rewrite" ? 0 : 1;
    const bRank = b.type === "rewrite" ? 0 : 1;
    if (aRank !== bRank) return aRank - bRank;
    const aPos = a.type === "insert_after" ? (a.after_item ?? 0) : 0;
    const bPos = b.type === "insert_after" ? (b.after_item ?? 0) : 0;
    return bPos - aPos; // descending — bottom of block first
  });
  for (const op of sortedOps) {
    const blocks = extractRoleBlocks(tex);
    const block = findRoleBlock(blocks, op.role);
    if (!block) continue;

    if (op.type === "rewrite") {
      const item = block.items.find(i => i.index === op.item);
      if (!item) continue;
      tex = `${tex.slice(0, item.startOffset)}${formatItem(op.new_item)}${tex.slice(item.endOffset)}`;
      continue;
    }

    if (op.type === "insert_first") {
      const first = block.items[0];
      const insertAt = first?.startOffset ?? block.itemizeEndOffset;
      tex = `${tex.slice(0, insertAt)}${formatItem(op.item)}\n${tex.slice(insertAt)}`;
      continue;
    }

    const after = block.items.find(i => i.index === op.after_item) ?? block.items[block.items.length - 1];
    const insertAt = after ? after.endOffset : block.itemizeEndOffset;
    tex = `${tex.slice(0, insertAt)}\n${formatItem(op.item)}${tex.slice(insertAt)}`;
  }
  return tex;
}

/**
 * Normalizes bullet text before insertion or rewrite.
 *
 * @param item - Raw item text from patch planner.
 * @returns Bullet string guaranteed to start with `\item`.
 */
function formatItem(item: string): string {
  const trimmed = item.trim();
  return trimmed.startsWith("\\item") ? trimmed : `\\item ${trimmed}`;
}
