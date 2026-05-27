const BANNED_STYLE_PATTERNS = [
  /demonstrating transferable/i,
  /analogous to/i,
  /akin to/i,
  /whose syntax (?:and|or) features/i,
  /foundational knowledge of/i,
  /directly applicable to/i,
  /translate[s]? directly to/i,
  /immediately useful in/i,
  /comparable to/i,
  /while not having direct/i,
  /with limited .* exposure/i,
];

export function findBannedStylePhrases(text: string): string[] {
  return BANNED_STYLE_PATTERNS
    .filter(pattern => pattern.test(text))
    .map(pattern => pattern.source);
}

export function hasBannedStylePhrase(text: string): boolean {
  return findBannedStylePhrases(text).length > 0;
}
