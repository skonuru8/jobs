/**
 * json-repair.ts — lightweight JSON truncation recovery.
 */

export function isTruncationError(err: unknown): boolean {
  if (!(err instanceof SyntaxError)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("unterminated string") ||
    msg.includes("unexpected end") ||
    msg.includes("end of json") ||
    msg.includes("expected double-quoted property name") ||
    msg.includes("expected property name") ||
    msg.includes("expected a json value") ||
    msg.includes("expected ',' or ']'") ||
    msg.includes("expected ',' or '}'") ||
    msg.includes("expected ':' after property name") ||
    msg.includes("unexpected token")
  );
}

export function repairTruncatedJson(raw: string): string {
  let inString = false;
  let escape = false;
  const stack: string[] = [];

  for (const ch of raw) {
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }

  let s = raw;

  if (inString) {
    const trailingBackslashes = s.match(/(\\+)$/);
    if (trailingBackslashes && trailingBackslashes[1].length % 2 === 1) {
      s = s.slice(0, -1);
    }
    s = s.replace(/\\u[0-9a-fA-F]{0,3}$/, "");
    s += '"';
  }

  let prev: string;
  do {
    prev = s;
    s = s.replace(/\s+$/, "");
    s = s.replace(/([:,[{])\s*(t|tr|tru|f|fa|fal|fals|n|nu|nul)$/, "$1");
    s = s.replace(/([:,\[])\s*(-|\d+\.|\d*\.?\d+[eE][-+]?)$/, "$1");
    s = s.replace(/([{,])\s*"(?:[^"\\]|\\.)*"\s*:?\s*$/, "$1");
    s = s.replace(/[,:]\s*$/, "");
  } while (s !== prev);

  s += stack.reverse().join("");
  return s;
}
