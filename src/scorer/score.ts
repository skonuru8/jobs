/**
 * score.ts — composite scorer wiring all 5 components.
 *
 * Bible §5 stage 11-12:
 *   - Weighted sum of 5 components → [0, 1] score
 *   - gate_passed = score >= threshold
 *   - Full breakdown stored, not just the number
 *
 * Semantic component is best-effort: 0 if embeddings unavailable.
 * That drops the effective max score for semantic-less runs, so threshold
 * accounts for it (0.55 threshold designed with semantic=0 in mind).
 */

import {
    scoreSkills,
    scoreYOE,
    scoreSeniority,
    scoreLocation,
    scoreSemantic,
  } from "./components.js";
  
  import {
    ScoringJobInput,
    ScoringProfileInput,
    ScoringWeights,
    ScoreResult,
    ScoreComponents,
  } from "./types.js";
  
  // ---------------------------------------------------------------------------
  // Default config — overridden by config/config.json at runtime
  // ---------------------------------------------------------------------------
  
  export const DEFAULT_WEIGHTS: ScoringWeights = {
    skills:    0.35,
    semantic:  0.25,
    yoe:       0.15,
    seniority: 0.15,
    location:  0.10,
  };
  
  export const DEFAULT_THRESHOLD = 0.55;
  
  
  // ---------------------------------------------------------------------------
  // Main scorer
  // ---------------------------------------------------------------------------
  
  /**
   * Score a job against a profile.
   *
   * @param job             - extracted job fields (post-filter, post-extraction)
   * @param profile         - user profile
   * @param jobEmbedding    - job embedding vector (null = skip semantic)
   * @param profileEmbedding - profile embedding vector (null = skip semantic)
   * @param weights         - scoring weights (default: bible v4 weights)
   * @param threshold       - gate threshold (default: 0.55)
   */
  export function scoreJob(
    job:               ScoringJobInput,
    profile:           ScoringProfileInput,
    jobEmbedding:      Float32Array | null = null,
    profileEmbedding:  Float32Array | null = null,
    weights:           ScoringWeights = DEFAULT_WEIGHTS,
    threshold:         number = DEFAULT_THRESHOLD,
  ): ScoreResult {
  
    // --- Component scores ---
    const skillScore = scoreSkills(
      job.required_skills,
      profile.skills,
    );
  
    const yoeScore = scoreYOE(
      job.years_experience.min,
      job.years_experience.max,
      profile.years_experience,
    );
  
    const seniorityScore = scoreSeniority(
      job.seniority,
      profile.acceptable_seniority,
    );
  
    const locationScore = scoreLocation(
      job.location,
      profile.location,
    );
  
    const semanticScore = scoreSemantic(jobEmbedding, profileEmbedding);
  
    const components: ScoreComponents = {
      skills:    round(skillScore),
      semantic:  round(semanticScore),
      yoe:       round(yoeScore),
      seniority: round(seniorityScore),
      location:  round(locationScore),
    };
  
    // --- Weighted composite ---
    // If semantic embedding is unavailable (score=0), redistribute its weight
    // proportionally across the other components so max possible score stays ~1.
    let effectiveWeights = weights;
    if (!jobEmbedding || !profileEmbedding) {
      effectiveWeights = _redistributeSemanticWeight(weights);
    }
  
    const score = round(
      components.skills    * effectiveWeights.skills +
      components.semantic  * effectiveWeights.semantic +
      components.yoe       * effectiveWeights.yoe +
      components.seniority * effectiveWeights.seniority +
      components.location  * effectiveWeights.location
    );
  
    return {
      score,
      gate_passed: score >= threshold,
      components,
      weights: effectiveWeights,
      threshold,
    };
  }
  
  
  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  
  /**
   * When semantic scoring is unavailable, redistribute its weight
   * proportionally across the other 4 components.
   *
   * Keeps skills as the dominant signal (still 0.35+ after redistribution).
   */
  function _redistributeSemanticWeight(w: ScoringWeights): ScoringWeights {
    const sem = w.semantic;
    const rest = w.skills + w.yoe + w.seniority + w.location;
    if (rest === 0) return w;
  
    return {
      skills:    round(w.skills    + sem * (w.skills    / rest)),
      semantic:  0,
      yoe:       round(w.yoe       + sem * (w.yoe       / rest)),
      seniority: round(w.seniority + sem * (w.seniority / rest)),
      location:  round(w.location  + sem * (w.location  / rest)),
    };
  }
  
  function round(n: number): number {
    return Math.round(n * 1000) / 1000;
  }