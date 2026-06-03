/**
 * A single deterministic mutation to apply to the canonical tex.
 *
 * - `insert_after`  — insert a new `\item` after the 1-indexed `after_item` in the role block.
 * - `rewrite`       — replace the 1-indexed `item` line in the role block with `new_item`.
 * - `insert_first`  — insert a new `\item` before all existing items in the role block.
 *
 * `role` must exactly match an employer string from the parsed EXPERIENCE section.
 * Item positions are 1-indexed within the role block. No delete op — patch never removes bullets.
 */
export type PatchOp =
  | { type: "insert_after"; role: string; after_item: number; item: string }
  | { type: "rewrite"; role: string; item: number; new_item: string }
  | { type: "insert_first"; role: string; item: string };

export interface ItemLine {
  /** 1-indexed position within the parent role block. Used in PatchOp item/after_item. */
  index: number;
  text: string;
  line: number;
  startOffset: number;
  endOffset: number;
}

export interface RoleBlock {
  role: string;
  line: number;
  startOffset: number;
  endOffset: number;
  itemizeEndOffset: number;
  items: ItemLine[];
}

export interface PatchCoverage {
  /** Number of fabricate/reframe directives whose key terms landed in the target role block. */
  covered: number;
  /** Total active (fabricate/reframe) directives checked. */
  total: number;
  /** jd_requirement strings for directives whose terms were not found after retry. */
  missed: string[];
}

export interface PatchResult {
  tex: string;
  ops: PatchOp[];
  coverage: PatchCoverage;
  retry_count: number;
  failed_directives: string[];
  prompt_sha: string;
}
