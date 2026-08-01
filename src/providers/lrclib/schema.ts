import type { ProviderLyricsRecord } from "../../domain/types.js";

export type RecordValidation =
  | { valid: true; record: ProviderLyricsRecord }
  | { valid: false; message: string };

export function validateLrclibRecord(value: unknown): RecordValidation {
  if (!isRecord(value)) return invalid("record is not an object");
  if (!Number.isInteger(value.id) || (value.id as number) < 0) return invalid("id must be a non-negative integer");
  for (const key of ["trackName", "artistName", "albumName"] as const) {
    if (typeof value[key] !== "string") return invalid(`${key} must be a string`);
  }
  if (typeof value.duration !== "number" || !Number.isFinite(value.duration) || value.duration < 0) return invalid("duration must be a non-negative number");
  if (typeof value.instrumental !== "boolean") return invalid("instrumental must be a boolean");
  for (const key of ["plainLyrics", "syncedLyrics"] as const) {
    if (value[key] !== null && typeof value[key] !== "string") return invalid(`${key} must be a string or null`);
  }
  return { valid: true, record: {
    id: value.id as number,
    trackName: value.trackName as string,
    artistName: value.artistName as string,
    albumName: value.albumName as string,
    duration: value.duration as number,
    instrumental: value.instrumental as boolean,
    plainLyrics: value.plainLyrics as string | null,
    syncedLyrics: value.syncedLyrics as string | null,
  } };
}

export function validateLrclibSearch(value: unknown): { valid: true; records: ProviderLyricsRecord[] } | { valid: false; message: string } {
  if (!Array.isArray(value)) return { valid: false, message: "search response is not an array" };
  const records: ProviderLyricsRecord[] = [];
  for (const [index, item] of value.entries()) {
    const result = validateLrclibRecord(item);
    if (!result.valid) return { valid: false, message: `record ${index}: ${result.message}` };
    records.push(result.record);
  }
  return { valid: true, records };
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function invalid(message: string): RecordValidation { return { valid: false, message }; }
