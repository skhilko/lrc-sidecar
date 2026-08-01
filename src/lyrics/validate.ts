export interface LrcValidationOptions { maxBytes: number; durationSeconds: number | null }
export type LrcValidationResult =
  | { valid: true; content: string; timestampCount: number; maxTimestampSeconds: number }
  | { valid: false; code: string; message: string };

const TIMESTAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/gu;
const METADATA = /^\[(?:ar|al|ti|by|offset|re|ve|length):[^\]]*\]\s*$/iu;
const TIMESTAMP_LIKE = /\[\d{1,3}:[^\]]*\]/u;

export function validateLrc(input: unknown, options: LrcValidationOptions): LrcValidationResult {
  if (typeof input !== "string") return invalid("LRC_NOT_STRING", "synchronized lyrics must be a string");
  if (Buffer.byteLength(input, "utf8") > options.maxBytes) return invalid("LRC_TOO_LARGE", "synchronized lyrics exceed the byte limit");
  if (input.includes("\0")) return invalid("LRC_NUL", "synchronized lyrics contain a NUL byte");
  if (/<\s*(?:!doctype\s+html|html|body)(?:\s|>)/iu.test(input) || /^\s*[{[]\s*"?(?:error|message)"?\s*:/iu.test(input)) {
    return invalid("LRC_PAYLOAD", "synchronized lyrics look like HTML or an error payload");
  }

  const content = input.replace(/\r\n?/gu, "\n").replace(/\n*$/u, "\n");
  let timestampCount = 0;
  let maxTimestampSeconds = 0;
  let lyricTextFound = false;
  for (const line of content.split("\n")) {
    if (!line || METADATA.test(line)) continue;
    TIMESTAMP.lastIndex = 0;
    const matches = [...line.matchAll(TIMESTAMP)];
    if (TIMESTAMP_LIKE.test(line) && matches.length === 0) return invalid("LRC_TIMESTAMP", "malformed timestamp syntax");
    if (matches.length === 0) continue;
    const withoutTimestamps = line.replace(TIMESTAMP, "").trim();
    if (withoutTimestamps) lyricTextFound = true;
    for (const match of matches) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fractionText = match[3] ?? "";
      if (seconds >= 60) return invalid("LRC_TIMESTAMP", "timestamp seconds must be below 60");
      const fraction = fractionText ? Number(fractionText) / (10 ** fractionText.length) : 0;
      maxTimestampSeconds = Math.max(maxTimestampSeconds, minutes * 60 + seconds + fraction);
      timestampCount += 1;
    }
  }
  if (timestampCount === 0) return invalid("LRC_NO_TIMESTAMP", "no valid LRC timestamp was found");
  if (!lyricTextFound) return invalid("LRC_NO_TEXT", "no lyric text follows a timestamp");
  if (options.durationSeconds !== null && maxTimestampSeconds > options.durationSeconds + 30) {
    return invalid("LRC_AFTER_DURATION", "maximum timestamp is more than 30 seconds beyond track duration");
  }
  return { valid: true, content, timestampCount, maxTimestampSeconds };
}

function invalid(code: string, message: string): LrcValidationResult { return { valid: false, code, message }; }
