export const TRACK_STATUSES = [
  "downloaded",
  "existing",
  "instrumental",
  "not_found",
  "ambiguous",
  "metadata_incomplete",
  "unsupported",
  "invalid_audio",
  "invalid_lyrics",
  "provider_error",
  "rate_limited",
  "invalid_response",
  "write_error",
  "file_changed",
  "dry_run_match",
] as const;

export type TrackStatus = (typeof TRACK_STATUSES)[number];

export function isTrackStatus(value: unknown): value is TrackStatus {
  return typeof value === "string" && (TRACK_STATUSES as readonly string[]).includes(value);
}

export interface TrackIdentity {
  path: string;
  sizeBytes: number;
  modifiedAtMs: number;
  title: string | null;
  artists: string[];
  primaryArtist: string | null;
  albumArtist: string | null;
  album: string | null;
  durationSeconds: number | null;
  trackNumber: number | null;
  discNumber: number | null;
  musicBrainzRecordingId: string | null;
  musicBrainzReleaseId: string | null;
  metadataHash: string;
}

export interface ProviderLyricsRecord {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export type ProviderFailure =
  | { status: "not_found" }
  | { status: "rate_limited"; retryAfterMs: number }
  | { status: "temporary_error"; code: string; message: string; httpStatus?: number }
  | { status: "permanent_error"; code: string; message: string; httpStatus?: number }
  | { status: "invalid_response"; code: string; message: string; httpStatus?: number };

export type ProviderLookupResult =
  | { status: "found"; record: ProviderLyricsRecord; httpStatus: number }
  | { status: "instrumental"; record: ProviderLyricsRecord; httpStatus: number }
  | ProviderFailure;

export type ProviderSearchResult =
  | { status: "found"; records: ProviderLyricsRecord[]; httpStatus: number }
  | ProviderFailure;

export interface LyricsProvider {
  readonly name: string;
  exactLookup(track: TrackIdentity, signal: AbortSignal): Promise<ProviderLookupResult>;
  search(track: TrackIdentity, signal: AbortSignal): Promise<ProviderSearchResult>;
}

export type MatchReason =
  | "TITLE_STRICT"
  | "TITLE_RELAXED"
  | "TITLE_SIMILAR"
  | "TITLE_MISMATCH"
  | "ARTIST_STRICT"
  | "ARTIST_RELAXED"
  | "ARTIST_SET"
  | "ARTIST_PARTIAL"
  | "ARTIST_MISMATCH"
  | "ALBUM_STRICT"
  | "ALBUM_RELAXED"
  | "ALBUM_MISMATCH"
  | "DURATION_WITHIN_2"
  | "DURATION_WITHIN_5"
  | "DURATION_WITHIN_10"
  | "DURATION_MISMATCH"
  | "VERSION_CONFLICT"
  | "SCORE_BELOW_THRESHOLD"
  | "COMPETING_CANDIDATE"
  | "MISSING_SYNCED_LYRICS"
  | "INVALID_LRC";

export interface ScoredCandidate {
  record: ProviderLyricsRecord;
  score: number;
  reasons: MatchReason[];
  titleApproved: boolean;
  artistApproved: boolean;
  durationApproved: boolean;
  hardRejected: boolean;
}

export type MatchDecision =
  | { decision: "accept"; candidate: ScoredCandidate; score: number; reasons: MatchReason[] }
  | { decision: "reject"; reasons: MatchReason[]; candidates: ScoredCandidate[] }
  | { decision: "ambiguous"; candidates: ScoredCandidate[]; reasons: MatchReason[] };

export interface TrackState {
  audioPath: string;
  rootPath: string;
  sizeBytes: number;
  modifiedAtMs: number;
  metadataHash: string;
  title: string | null;
  primaryArtist: string | null;
  album: string | null;
  durationSeconds: number | null;
  status: TrackStatus;
  provider: string | null;
  providerRecordId: number | null;
  matchScore: number | null;
  lyricsKind: string | null;
  outputPath: string | null;
  attemptCount: number;
  firstSeenAtMs: number;
  lastCheckedAtMs: number | null;
  retryAfterMs: number | null;
  completedAtMs: number | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  appVersion: string;
}

export interface LookupAttempt {
  audioPath: string;
  startedAtMs: number;
  completedAtMs: number;
  provider: string;
  operation: "exact" | "search";
  outcome: string;
  httpStatus: number | null;
  candidateCount: number | null;
  selectedRecordId: number | null;
  selectedScore: number | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface LogEvent {
  event: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  at: string;
  [key: string]: unknown;
}

export interface Logger {
  event(event: { event: string; level: LogEvent["level"]; message: string; [key: string]: unknown }): void;
}
