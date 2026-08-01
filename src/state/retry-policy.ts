import type { RetryIntervals } from "../config/defaults.js";
import type { TrackState, TrackStatus } from "../domain/types.js";

export function retryTime(status: TrackStatus, now: number, retry: RetryIntervals, providerRetryAfter?: number): number | null {
  switch (status) {
    case "instrumental": return now + retry.instrumentalMs;
    case "not_found": return now + retry.notFoundMs;
    case "ambiguous": return now + retry.ambiguousMs;
    case "invalid_lyrics": return now + retry.invalidLyricsMs;
    case "provider_error": return now + retry.providerErrorMs;
    case "invalid_response": return now + retry.invalidResponseMs;
    case "rate_limited": return providerRetryAfter ?? now + retry.providerErrorMs;
    case "write_error":
    case "file_changed":
    case "dry_run_match": return now;
    case "downloaded":
    case "existing":
    case "metadata_incomplete":
    case "unsupported":
    case "invalid_audio": return null;
  }
}

export function isEligible(
  state: TrackState | null,
  file: { sizeBytes: number; modifiedAtMs: number },
  now: number,
  forceRecheck: boolean,
): boolean {
  if (forceRecheck || !state) return true;
  if (state.sizeBytes !== file.sizeBytes || state.modifiedAtMs !== file.modifiedAtMs) return true;
  if (state.retryAfterMs !== null) return state.retryAfterMs <= now;
  return ["write_error", "file_changed", "dry_run_match"].includes(state.status);
}
