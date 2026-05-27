export interface JdSegments {
  tags_chips: string;
  required: string;
  preferred: string;
  responsibilities: string;
  other: string;
}

const HEADERS: Array<[keyof JdSegments, RegExp]> = [
  [
    "required",
    /(?:^|\n)\s*(?:Required(?:\s+Skills)?|Mandatory(?:\s+Skills)?|Must[\s-]Have(?:s)?|Qualifications|Requirements|What you'?ll need|Minimum Qualifications)\s*:?\s*\n/i,
  ],
  [
    "preferred",
    /(?:^|\n)\s*(?:Preferred(?:\s+Qualifications)?|Nice[\s-]to[\s-]Have(?:s)?|Plus(?:es)?|Bonus(?:\s+Points)?|Good[\s-]to[\s-]Have|Desired|Nice if you have)\s*:?\s*\n/i,
  ],
  [
    "responsibilities",
    /(?:^|\n)\s*(?:Responsibilities|What you'?ll do|Role|Duties|You will|In this role|Key Responsibilities|Job Responsibilities)\s*:?\s*\n/i,
  ],
];

export function segmentJd(raw: string): JdSegments {
  const segments: JdSegments = {
    tags_chips: "",
    required: "",
    preferred: "",
    responsibilities: "",
    other: "",
  };

  const matches: Array<{ key: keyof JdSegments; index: number; end: number }> = [];
  for (const [key, regex] of HEADERS) {
    const all = raw.matchAll(new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`));
    for (const m of all) {
      if (m.index === undefined) continue;
      matches.push({ key, index: m.index, end: m.index + m[0].length });
    }
  }
  matches.sort((a, b) => a.index - b.index);

  const first = matches[0];
  const top = first ? raw.slice(0, first.index).trim() : raw.trim();
  const chips = extractTopTechChips(top);
  segments.tags_chips = chips;
  segments.other = chips ? top.replace(chips, "").trim() : top;

  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const next = matches[i + 1];
    const body = raw.slice(cur.end, next ? next.index : raw.length).trim();
    if (!body) continue;
    segments[cur.key] = [segments[cur.key], body].filter(Boolean).join("\n\n");
  }

  return segments;
}

function extractTopTechChips(top: string): string {
  const lines = top
    .split(/\n+/)
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 12);

  for (const line of lines) {
    const candidates = line.split(/\s*(?:\||,|•|·)\s*/).filter(Boolean);
    if (candidates.length < 3) continue;
    const techish = candidates.filter(isTechishToken);
    if (techish.length >= 3 && techish.length / candidates.length >= 0.6) {
      return line;
    }
  }
  return "";
}

function isTechishToken(token: string): boolean {
  const t = token.trim();
  if (t.length < 2 || t.length > 40) return false;
  if (/\b(experience|engineer|developer|remote|onsite|hybrid|salary|full[-\s]?time)\b/i.test(t)) {
    return false;
  }
  return /[A-Z0-9+#.]|java|spring|aws|azure|gcp|sql|kafka|docker|react|angular|node|python|hibernate|kubernetes/i.test(t);
}
