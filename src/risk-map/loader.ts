import * as fs from "fs";
import * as path from "path";
import type { RiskEntry } from "./types";

const FILENAME = "tech-equivalence-risk-map.json";

interface Cache {
  jdIndex:     Record<string, RiskEntry[]>;
  sourceIndex: Record<string, RiskEntry[]>;
  loadedAt:    string;
}

let cache: Cache | null = null;

export function loadRiskMap(repoRoot: string): void {
  const p = path.join(repoRoot, "config", FILENAME);
  if (!fs.existsSync(p)) {
    throw new Error(`Risk map not found at ${p}. v5 cannot run without it.`);
  }
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  if (!raw.jd_target_index || !raw.resume_source_index) {
    throw new Error(`Risk map at ${p} is missing jd_target_index or resume_source_index`);
  }
  cache = {
    jdIndex:     normalizeIndex(raw.jd_target_index),
    sourceIndex: normalizeIndex(raw.resume_source_index),
    loadedAt:    new Date().toISOString(),
  };
}

function normalizeIndex(idx: Record<string, RiskEntry[]>): Record<string, RiskEntry[]> {
  const out: Record<string, RiskEntry[]> = {};
  for (const [k, v] of Object.entries(idx)) {
    out[k.toLowerCase().trim()] = v;
  }
  return out;
}

export function getRiskMapCache(): Cache {
  if (!cache) throw new Error("Risk map not loaded — call loadRiskMap(repoRoot) at startup");
  return cache;
}

export function isRiskMapLoaded(): boolean {
  return cache !== null;
}
