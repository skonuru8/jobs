import { extractRoleBlocks, findRoleBlock } from "./parser";
import type { PatchOp } from "./types";

export function applyPatchOps(canonicalTex: string, ops: PatchOp[]): string {
  let tex = canonicalTex;
  for (const op of ops) {
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

function formatItem(item: string): string {
  const trimmed = item.trim();
  return trimmed.startsWith("\\item") ? trimmed : `\\item ${trimmed}`;
}
