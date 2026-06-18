/**
 * types.ts — Shared patch-planning and patch-application contracts.
 *
 * Defines JSON-op shapes, parsed role-block metadata, and patch result payloads
 * used by patch generator, parser, applier, and orchestrator. These types keep
 * patch mode deterministic by forcing all mutations to reference canonical roles
 * and 1-indexed bullet positions.
 *
 * Called by: patch parser/generator/apply/coverage/orchestrator modules
 * Writes to: nothing
 * Side effects: none
 */

/**
 * A single deterministic resume mutation emitted by patch-planning mode.
 *
 * Each variant targets one parsed EXPERIENCE role block and preserves the
 * no-delete invariant. Positions are always 1-indexed within the target role.
 */
export type PatchOp =
  /**
   * Insert one new `\item` after an existing bullet inside target role block.
   * `after_item` must reference valid 1-indexed bullet position.
   */
  | {
    /** Discriminant for append-after-existing-bullet behavior. */
    type: "insert_after";
    /** Exact or roleish-match employer label from parsed EXPERIENCE section. */
    role: string;
    /** Existing 1-indexed bullet after which new bullet should be inserted. */
    after_item: number;
    /** Full bullet text or bare content; applier normalizes missing `\item`. */
    item: string;
  }
  /**
   * Replace one existing bullet while preserving surrounding role structure.
   * Used when directive fits best as reframed evidence instead of new bullet.
   */
  | {
    /** Discriminant for in-place bullet replacement behavior. */
    type: "rewrite";
    /** Exact or roleish-match employer label from parsed EXPERIENCE section. */
    role: string;
    /** Existing 1-indexed bullet position to replace. */
    item: number;
    /** Replacement bullet text or bare content; applier normalizes `\item`. */
    new_item: string;
  }
  /**
   * Insert one new `\item` at top of existing itemize block for target role.
   * Used when strongest missing evidence should lead role's bullets.
   */
  | {
    /** Discriminant for top-of-role insertion behavior. */
    type: "insert_first";
    /** Exact or roleish-match employer label from parsed EXPERIENCE section. */
    role: string;
    /** Full bullet text or bare content; applier normalizes missing `\item`. */
    item: string;
  };

export interface ItemLine {
  /** 1-indexed position within the parent role block. Used in PatchOp item/after_item. */
  index: number;
  /** Raw `\item` text slice, including multi-line content when present. */
  text: string;
  /** Source line number where item starts in canonical TeX. */
  line: number;
  /** Byte offset where item begins in full TeX string. */
  startOffset: number;
  /** Byte offset where item ends, excluding trailing newline padding. */
  endOffset: number;
}

export interface RoleBlock {
  /** Parsed employer or project label used for directive-to-role matching. */
  role: string;
  /** Source line number where role heading starts in canonical TeX. */
  line: number;
  /** Byte offset where role heading block begins in full TeX string. */
  startOffset: number;
  /** Byte offset where role block ends after `\end{itemize}`. */
  endOffset: number;
  /** Byte offset where `\end{itemize}` token begins for insertion fallback. */
  itemizeEndOffset: number;
  /** Ordered bullets currently present inside role block. */
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
  /** Final patched LaTeX emitted by orchestrator when patch mode succeeds. */
  tex: string;
  /** Deterministic patch ops that produced `tex` from canonical source. */
  ops: PatchOp[];
  /** Coverage audit for fabricate/reframe directives after final retry. */
  coverage: PatchCoverage;
  /** Number of additional planner retries needed after first attempt. */
  retry_count: number;
  /** `jd_requirement` entries still uncovered in final patched resume. */
  failed_directives: string[];
  /** Stable hash of patch prompt template used to generate ops. */
  prompt_sha: string;
  /** Ops emitted by planner that were dropped because their role was not in canonical blocks. */
  ops_dropped_unknown_role: number;
  /** jd_requirement values for acknowledge-handled directives (no resume op, deferred to cover letter). */
  acknowledged_gaps?: string[];
}
