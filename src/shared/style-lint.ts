const BANNED_STYLE_PATTERNS = [
  /demonstrating transferable/i,
  /analogous to/i,
  /akin to/i,
  /parallel to/i,
  /whose syntax (?:and|or) features/i,
  /\bwhose syntax\b/i,
  /syntactically equivalent to/i,
  /foundational knowledge of/i,
  /working knowledge of/i,
  /transitional knowledge of/i,
  /deepening understanding/i,
  /directly applicable to/i,
  /translate[s]? directly to/i,
  /immediately useful in/i,
  /comparable to/i,
  /while not having direct/i,
  /with limited .* exposure/i,
  /transferable skills/i,
  /\baligning with your need for\b/i,
  /\bas required by the role\b/i,
  /\bhands-on exposure\b/i,
  /\bexposure to\b/i,
  /\bgained hands-on exposure\b/i,
];

export function findBannedStylePhrases(text: string): string[] {
  return BANNED_STYLE_PATTERNS
    .filter(pattern => pattern.test(text))
    .map(pattern => pattern.source);
}

export function hasBannedStylePhrase(text: string): boolean {
  return findBannedStylePhrases(text).length > 0;
}
