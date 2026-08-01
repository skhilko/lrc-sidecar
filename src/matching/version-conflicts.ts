import { relaxedNormalize, tokenize } from "../metadata/normalize.js";

const MATERIAL_LABELS = new Set(["live", "acoustic", "instrumental", "remix", "demo", "karaoke", "mono", "stereo"]);
const PHRASES = ["radio edit", "extended mix", "club mix", "alternate version"];

export function hasVersionConflict(left: string, right: string): boolean {
  const normalizedLeft = relaxedNormalize(left);
  const normalizedRight = relaxedNormalize(right);
  const leftTokens = tokenize(normalizedLeft);
  const rightTokens = tokenize(normalizedRight);
  for (const label of MATERIAL_LABELS) if (leftTokens.has(label) !== rightTokens.has(label)) return true;
  for (const phrase of PHRASES) if (normalizedLeft.includes(phrase) !== normalizedRight.includes(phrase)) return true;
  return false;
}
