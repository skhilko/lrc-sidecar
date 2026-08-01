import { posix } from "node:path";

/**
 * Patterns match root-relative POSIX paths. Plain patterns are path prefixes;
 * `*` matches within one segment, `?` one character, and `**` across segments.
 */
export function matchesPatterns(relativePath: string, patterns: readonly string[]): boolean {
  const normalized = relativePath.split("\\").join("/").replace(/^\.\//, "");
  return patterns.some((pattern) => matchesPattern(normalized, pattern));
}

function matchesPattern(path: string, input: string): boolean {
  const pattern = posix.normalize(input.split("\\").join("/")).replace(/^\.\//, "").replace(/\/$/, "");
  if (!/[?*]/.test(pattern)) return path === pattern || path.startsWith(`${pattern}/`);
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      source += ".*";
      index += 1;
    } else if (character === "*") source += "[^/]*";
    else if (character === "?") source += "[^/]";
    else source += character?.replace(/[\\^$.[\]{}()+|]/g, "\\$&");
  }
  return new RegExp(`${source}$`, "u").test(path);
}
