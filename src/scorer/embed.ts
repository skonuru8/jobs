/**
 * embed.ts — local text embeddings via @huggingface/transformers.
 *
 * Model: bge-small-en-v1.5 (384-dim, q8 quantized, ~33MB)
 * Bible §12 milestone 3a: "bge-small-en-v1.5 via @huggingface/transformers"
 *
 * Usage:
 *   const emb = await getEmbedder();
 *   const vec = await emb.embed("Senior Java Engineer at fintech company...");
 *
 * Model is lazy-loaded on first call and cached for the process lifetime.
 * Embeddings are cached by content hash to avoid recomputing same text.
 */

import { createHash } from "crypto";

// Type-only import to avoid hard failure if package not installed
let _pipeline: ((...args: any[]) => Promise<any>) | null = null;
let _pipelineLoaded = false;

const MODEL_NAME = "Xenova/bge-small-en-v1.5";
const CACHE_SIZE = 500;   // LRU cap — keeps memory bounded

// Simple LRU cache: Map preserves insertion order, delete+re-insert = move to end
const _cache = new Map<string, Float32Array>();


/**
 * Returns an embedder object with a single embed() method.
 * Call once, reuse. Lazy-loads the model on first call.
 *
 * Throws if @huggingface/transformers is not installed.
 */
export async function getEmbedder(): Promise<{ embed: (text: string) => Promise<Float32Array> }> {
  return { embed: embedText };
}


/**
 * Embed a text string → Float32Array (384 dimensions).
 *
 * First call downloads + loads model (~33MB, once per machine).
 * Subsequent calls use cached model (fast, in-process).
 * Identical inputs use cached embedding (zero recompute).
 *
 * Returns a zero vector on any error — caller handles gracefully.
 */
export async function embedText(text: string): Promise<Float32Array> {
  if (!text.trim()) return new Float32Array(384);

  const key = _hash(text);
  if (_cache.has(key)) {
    // Move to end (LRU promotion)
    const val = _cache.get(key)!;
    _cache.delete(key);
    _cache.set(key, val);
    return val;
  }

  const pipeline = await _loadPipeline();
  if (!pipeline) return new Float32Array(384);

  try {
    // bge models produce {data: Float32Array} from feature-extraction pipeline
    const output = await pipeline(text, {
      pooling:   "mean",
      normalize: true,
    });

    const vec = _toFloat32(output?.data ?? output);
    _cacheSet(key, vec);
    return vec;
  } catch (e) {
    console.error("[embed] Embedding failed:", e);
    return new Float32Array(384);
  }
}


/**
 * Embed a profile into a single representative vector.
 * Concatenates target titles + top skills into a single string.
 *
 * Called once at pipeline start, result reused for all job comparisons.
 */
export async function embedProfile(profile: {
  target_titles: string[];
  skills: Array<{ name: string; confidence: string; category: string }>;
}): Promise<Float32Array> {
  const titlePart = profile.target_titles.join(", ");
  const expertSkills = profile.skills
    .filter(s => s.confidence === "expert" || s.confidence === "strong")
    .map(s => s.name)
    .slice(0, 20)
    .join(", ");

  const text = `${titlePart}. Skills: ${expertSkills}`;
  return embedText(text);
}


/**
 * Embed job description text for semantic scoring.
 * Uses responsibilities + first 500 chars of description_raw.
 */
export async function embedJob(job: {
  responsibilities: string[];
  description_raw:  string;
  title:            string;
}): Promise<Float32Array> {
  const parts = [
    job.title,
    ...job.responsibilities.slice(0, 5),
    job.description_raw.slice(0, 500),
  ].filter(Boolean);

  return embedText(parts.join(". "));
}


// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function _loadPipeline(): Promise<((...args: any[]) => Promise<any>) | null> {
  if (_pipelineLoaded) return _pipeline;

  _pipelineLoaded = true;

  try {
    // Dynamic import so missing package is a runtime error, not parse error
    const { pipeline, env } = await import("@huggingface/transformers");

    // Use WASM backend on Node (no native GPU needed)
    if (env.backends.onnx.wasm) {
      env.backends.onnx.wasm.numThreads = 1;
    }

    _pipeline = await (pipeline as (...args: unknown[]) => Promise<any>)(
      "feature-extraction", MODEL_NAME, { dtype: "q8" }
    );

    console.error(`[embed] Model loaded: ${MODEL_NAME}`);
    return _pipeline;
  } catch (e: any) {
    if (e?.code === "MODULE_NOT_FOUND" || e?.message?.includes("Cannot find module")) {
      console.error(
        "[embed] @huggingface/transformers not installed.\n" +
        "  Run: npm install @huggingface/transformers\n" +
        "  Semantic scoring will be skipped (score component = 0)."
      );
    } else {
      console.error("[embed] Model load failed:", e?.message ?? e);
    }
    return null;
  }
}

function _hash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function _toFloat32(data: unknown): Float32Array {
  if (data instanceof Float32Array) return data;
  if (Array.isArray(data)) return new Float32Array(data as number[]);
  // Tensor object with nested data
  if (data && typeof data === "object" && "data" in data) {
    return _toFloat32((data as any).data);
  }
  return new Float32Array(384);
}

function _cacheSet(key: string, vec: Float32Array): void {
  if (_cache.size >= CACHE_SIZE) {
    // Evict oldest (first entry)
    const oldest = _cache.keys().next().value as string;
    _cache.delete(oldest);
  }
  _cache.set(key, vec);
}