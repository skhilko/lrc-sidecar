const QUOTES = /[‘’‚‛]/gu;
const DOUBLE_QUOTES = /[“”„‟]/gu;
const DASHES = /[‐‑‒–—―]/gu;
const FEATURE_SUFFIX = /\s*[([]?\s*(?:feat(?:uring)?\.?|ft\.?)\s+([^\])]+)\s*[\])]?\s*$/iu;
const REMASTER = /\b(?:re-?master(?:ed)?)(?:\s+\d{4})?\b/giu;

export function strictNormalize(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .replace(QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, "-")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en-US");
}

export function relaxedNormalize(value: string | null | undefined): string {
  return strictNormalize(value)
    .replace(REMASTER, "remaster")
    .replace(/&/gu, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

export function normalizedTitle(title: string, artists: readonly string[]): { strict: string; relaxed: string } {
  const strict = strictNormalize(title);
  const match = FEATURE_SUFFIX.exec(title);
  if (!match?.[1]) return { strict, relaxed: relaxedNormalize(title) };
  const featured = relaxedNormalize(match[1]);
  const represented = artists.some((artist) => relaxedNormalize(artist).includes(featured));
  const withoutFeature = represented ? title.slice(0, match.index) : title;
  return { strict, relaxed: relaxedNormalize(withoutFeature) };
}

export function tokenize(value: string): Set<string> {
  return new Set(relaxedNormalize(value).split(" ").filter(Boolean));
}

export function tokenSimilarity(left: string, right: string): number {
  const a = tokenize(left);
  const b = tokenize(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return (2 * intersection) / (a.size + b.size);
}
