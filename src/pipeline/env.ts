export function parseBoolEnv(v: string | undefined, def = false): boolean {
  if (v == null || v === "") return def;
  return ["1", "true", "yes"].includes(v.trim().toLowerCase());
}
