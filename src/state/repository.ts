import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { LookupAttempt, TrackState, TrackStatus } from "../domain/types.js";
import { isTrackStatus } from "../domain/types.js";
import { FatalError } from "../domain/errors.js";

export class StateRepository {
  private readonly getStatement: StatementSync;
  private readonly upsertStatement: StatementSync;
  private readonly attemptStatement: StatementSync;

  constructor(private readonly database: DatabaseSync) {
    this.getStatement = database.prepare("SELECT * FROM track_state WHERE audio_path = ?");
    this.upsertStatement = database.prepare(`
      INSERT INTO track_state (
        audio_path, root_path, size_bytes, modified_at_ms, metadata_hash, title, primary_artist, album,
        duration_seconds, status, provider, provider_record_id, match_score, lyrics_kind, output_path,
        attempt_count, first_seen_at_ms, last_checked_at_ms, retry_after_ms, completed_at_ms,
        last_error_code, last_error_message, app_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(audio_path) DO UPDATE SET
        root_path=excluded.root_path, size_bytes=excluded.size_bytes, modified_at_ms=excluded.modified_at_ms,
        metadata_hash=excluded.metadata_hash, title=excluded.title, primary_artist=excluded.primary_artist,
        album=excluded.album, duration_seconds=excluded.duration_seconds, status=excluded.status,
        provider=excluded.provider, provider_record_id=excluded.provider_record_id, match_score=excluded.match_score,
        lyrics_kind=excluded.lyrics_kind, output_path=excluded.output_path,
        attempt_count=track_state.attempt_count + excluded.attempt_count,
        last_checked_at_ms=excluded.last_checked_at_ms, retry_after_ms=excluded.retry_after_ms,
        completed_at_ms=excluded.completed_at_ms, last_error_code=excluded.last_error_code,
        last_error_message=excluded.last_error_message, app_version=excluded.app_version
    `);
    this.attemptStatement = database.prepare(`
      INSERT INTO lookup_attempt (
        audio_path, started_at_ms, completed_at_ms, provider, operation, outcome, http_status,
        candidate_count, selected_record_id, selected_score, error_code, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  get(audioPath: string): TrackState | null {
    const row = this.getStatement.get(audioPath) as Record<string, unknown> | undefined;
    return row ? mapTrackState(row) : null;
  }

  save(state: TrackState, attempted: boolean): void {
    this.upsertStatement.run(
      state.audioPath, state.rootPath, state.sizeBytes, state.modifiedAtMs, state.metadataHash, state.title,
      state.primaryArtist, state.album, state.durationSeconds, state.status, state.provider,
      state.providerRecordId, state.matchScore, state.lyricsKind, state.outputPath, attempted ? 1 : 0,
      state.firstSeenAtMs, state.lastCheckedAtMs, state.retryAfterMs, state.completedAtMs,
      state.lastErrorCode, state.lastErrorMessage, state.appVersion,
    );
  }

  recordAttempt(attempt: LookupAttempt): void {
    this.attemptStatement.run(
      attempt.audioPath, attempt.startedAtMs, attempt.completedAtMs, attempt.provider, attempt.operation,
      attempt.outcome, attempt.httpStatus, attempt.candidateCount, attempt.selectedRecordId,
      attempt.selectedScore, attempt.errorCode, attempt.errorMessage,
    );
  }

  bindRoot(root: string): void {
    const row = this.database.prepare("SELECT value FROM app_state WHERE key = 'music_root'").get() as { value?: unknown } | undefined;
    if (row && row.value !== root) throw new FatalError(`state database belongs to a different music root: ${String(row.value)}`);
    this.database.prepare("INSERT OR IGNORE INTO app_state(key, value) VALUES ('music_root', ?)").run(root);
  }

  status(now: number): StateSummary {
    const total = numberValue(this.database.prepare("SELECT count(*) AS value FROM track_state").get());
    const statusRows = this.database.prepare("SELECT status, count(*) AS count FROM track_state GROUP BY status ORDER BY status").all() as Record<string, unknown>[];
    const counts: Partial<Record<TrackStatus, number>> = {};
    for (const row of statusRows) {
      if (!isTrackStatus(row.status) || typeof row.count !== "number") throw new FatalError("invalid status data in state database");
      counts[row.status] = row.count;
    }
    const retryEligible = numberValue(this.database.prepare("SELECT count(*) AS value FROM track_state WHERE retry_after_ms IS NOT NULL AND retry_after_ms <= ?").get(now));
    const next = this.database.prepare("SELECT min(retry_after_ms) AS value FROM track_state WHERE retry_after_ms > ?").get(now) as { value?: unknown } | undefined;
    const recentDownloads = this.database.prepare("SELECT audio_path, completed_at_ms FROM track_state WHERE status='downloaded' ORDER BY completed_at_ms DESC LIMIT 10").all();
    const recentErrors = this.database.prepare("SELECT audio_path, status, last_error_code, last_error_message, last_checked_at_ms FROM track_state WHERE last_error_code IS NOT NULL ORDER BY last_checked_at_ms DESC LIMIT 10").all();
    return { total, counts, retryEligible, nextRetryAtMs: typeof next?.value === "number" ? next.value : null, recentDownloads, recentErrors };
  }
}

export interface StateSummary {
  total: number;
  counts: Partial<Record<TrackStatus, number>>;
  retryEligible: number;
  nextRetryAtMs: number | null;
  recentDownloads: readonly Record<string, unknown>[];
  recentErrors: readonly Record<string, unknown>[];
}

function mapTrackState(row: Record<string, unknown>): TrackState {
  if (!isTrackStatus(row.status)) throw new FatalError(`invalid track status in state database: ${String(row.status)}`);
  return {
    audioPath: stringValue(row.audio_path), rootPath: stringValue(row.root_path), sizeBytes: numberRequired(row.size_bytes),
    modifiedAtMs: numberRequired(row.modified_at_ms), metadataHash: stringValue(row.metadata_hash),
    title: nullableString(row.title), primaryArtist: nullableString(row.primary_artist), album: nullableString(row.album),
    durationSeconds: nullableNumber(row.duration_seconds), status: row.status, provider: nullableString(row.provider),
    providerRecordId: nullableNumber(row.provider_record_id), matchScore: nullableNumber(row.match_score),
    lyricsKind: nullableString(row.lyrics_kind), outputPath: nullableString(row.output_path),
    attemptCount: numberRequired(row.attempt_count), firstSeenAtMs: numberRequired(row.first_seen_at_ms),
    lastCheckedAtMs: nullableNumber(row.last_checked_at_ms), retryAfterMs: nullableNumber(row.retry_after_ms),
    completedAtMs: nullableNumber(row.completed_at_ms), lastErrorCode: nullableString(row.last_error_code),
    lastErrorMessage: nullableString(row.last_error_message), appVersion: stringValue(row.app_version),
  };
}

function stringValue(value: unknown): string { if (typeof value !== "string") throw new FatalError("invalid string in state database"); return value; }
function nullableString(value: unknown): string | null { return value === null ? null : stringValue(value); }
function numberRequired(value: unknown): number { if (typeof value !== "number") throw new FatalError("invalid number in state database"); return value; }
function nullableNumber(value: unknown): number | null { return value === null ? null : numberRequired(value); }
function numberValue(row: unknown): number {
  const value = (row as { value?: unknown } | undefined)?.value;
  return numberRequired(value);
}
