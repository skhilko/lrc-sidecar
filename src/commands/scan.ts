import { lstat } from "node:fs/promises";
import { dirname } from "node:path";
import type { AppConfig } from "../config/defaults.js";
import { APP_VERSION } from "../config/defaults.js";
import type { Logger, LookupAttempt, LyricsProvider, ProviderLyricsRecord, TrackIdentity, TrackState, TrackStatus } from "../domain/types.js";
import { errorMessage, sanitizeMessage } from "../domain/errors.js";
import { discoverAudioFiles } from "../discovery/scanner.js";
import { isOldEnough, snapshotRegularFile, type FileSnapshot } from "../discovery/stability.js";
import { createSidecarAtomic } from "../filesystem/atomic-writer.js";
import { cleanupStaleTemporaryFiles } from "../filesystem/cleanup.js";
import { acquireProcessLock } from "../filesystem/lock.js";
import { assertStateOutsideMusicRoot, sidecarPath, validateMusicRoot } from "../filesystem/paths.js";
import { validateLrc } from "../lyrics/validate.js";
import { decideSearchMatch, verifyExactMatch } from "../matching/decision.js";
import { readTrackIdentity } from "../metadata/reader.js";
import { LrclibProvider } from "../providers/lrclib/client.js";
import { openStateDatabase } from "../state/database.js";
import { StateRepository } from "../state/repository.js";
import { isEligible, retryTime } from "../state/retry-policy.js";

export interface ScanSummary {
  discovered: number; eligible: number; skipped: number; exactMatches: number; searchMatches: number;
  downloaded: number; existing: number; instrumental: number; notFound: number; ambiguous: number;
  temporaryErrors: number; permanentErrors: number; bytesWritten: number; providerRequests: number;
  rateLimitWaitMs: number; elapsedMs: number;
}

export interface ScanResult { summary: ScanSummary; exitCode: 0 | 1 }
export interface ScanDependencies { provider?: LyricsProvider; readMetadata?: typeof readTrackIdentity; writeSidecar?: typeof createSidecarAtomic; now?: () => number }

export async function runScan(musicRootInput: string, config: AppConfig, logger: Logger, dependencies: ScanDependencies = {}): Promise<ScanResult> {
  const started = Date.now();
  const root = await validateMusicRoot(musicRootInput);
  assertStateOutsideMusicRoot(root, config.statePath);
  const lock = await acquireProcessLock(config.lockPath);
  const stateDatabase = await openStateDatabase(config.statePath);
  const repository = new StateRepository(stateDatabase.database);
  const provider = dependencies.provider ?? new LrclibProvider(config);
  const readMetadata = dependencies.readMetadata ?? readTrackIdentity;
  const writeSidecar = dependencies.writeSidecar ?? createSidecarAtomic;
  const now = dependencies.now ?? Date.now;
  let operationalErrors = 0;
  const summary: ScanSummary = {
    discovered: 0, eligible: 0, skipped: 0, exactMatches: 0, searchMatches: 0, downloaded: 0,
    existing: 0, instrumental: 0, notFound: 0, ambiguous: 0, temporaryErrors: 0,
    permanentErrors: 0, bytesWritten: 0, providerRequests: 0, rateLimitWaitMs: 0, elapsedMs: 0,
  };
  const controller = new AbortController();
  const interrupt = (): void => controller.abort(new Error("scan interrupted"));
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);

  try {
    repository.bindRoot(root);
    const files = await discoverAudioFiles(root, { include: config.include, exclude: config.exclude, maxTracks: config.maxTracks });
    summary.discovered = files.length;
    logger.event({ event: "scan_started", level: "info", message: `Discovered ${files.length} audio track(s)`, root });
    for (const directory of new Set(files.map(dirname))) {
      await cleanupStaleTemporaryFiles(directory, config.tempMaxAgeMs).catch((error: unknown) => {
        logger.event({ event: "temporary_cleanup_error", level: "warn", message: sanitizeMessage(errorMessage(error)), path: directory });
      });
    }
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(config.metadataConcurrency, files.length) }, async () => {
      while (!controller.signal.aborted) {
        const index = nextIndex++;
        const audioPath = files[index];
        if (audioPath === undefined) return;
        const result = await processTrack(audioPath).catch((error: unknown) => {
          operationalErrors += 1;
          summary.temporaryErrors += 1;
          logger.event({ event: "track_error", level: "error", message: sanitizeMessage(errorMessage(error)), path: audioPath, code: "UNEXPECTED_TRACK_ERROR" });
          return null;
        });
        if (result?.operationalError) operationalErrors += 1;
      }
    });
    await Promise.all(workers);
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    const stats = provider instanceof LrclibProvider ? provider.stats : null;
    summary.providerRequests = stats?.requests ?? 0;
    summary.rateLimitWaitMs = stats?.rateLimitWaitMs ?? 0;
    summary.elapsedMs = Date.now() - started;
    stateDatabase.close();
    await lock.release();
  }
  logger.event({ event: "scan_summary", level: operationalErrors > 0 ? "warn" : "info", message: formatSummary(summary), ...summary });
  return { summary, exitCode: operationalErrors > 0 ? 1 : 0 };

  async function processTrack(audioPath: string): Promise<{ operationalError: boolean } | null> {
    const initial = await snapshotRegularFile(audioPath);
    if (!initial) { summary.skipped += 1; return null; }
    const outputPath = sidecarPath(root, audioPath);
    const oldState = repository.get(audioPath);
    const outputExists = await exists(outputPath);
    const unchangedCompleted = oldState && ["downloaded", "existing"].includes(oldState.status) && outputExists;
    if (!config.forceRecheck && unchangedCompleted && oldState.sizeBytes === initial.sizeBytes && oldState.modifiedAtMs === initial.modifiedAtMs) {
      summary.skipped += 1; return null;
    }
    if (!isEligible(oldState, initial, now(), config.forceRecheck) && !outputExists) { summary.skipped += 1; return null; }
    if (!isOldEnough(initial, config.stabilityAgeMs, now())) {
      summary.skipped += 1;
      saveOutcome(null, initial, "file_changed", { audioPath, lastErrorCode: "FILE_TOO_NEW", lastErrorMessage: "file modification time is inside the stability interval" }, false);
      emit("file_changed", "Deferred unstable track", audioPath);
      return { operationalError: false };
    }
    summary.eligible += 1;

    let track: TrackIdentity;
    try { track = await readMetadata(audioPath, initial); }
    catch (error) {
      saveOutcome(null, initial, "invalid_audio", { audioPath, lastErrorCode: "METADATA_PARSE", lastErrorMessage: sanitizeMessage(errorMessage(error)) }, false);
      summary.permanentErrors += 1;
      emit("invalid_audio", "Invalid audio metadata", audioPath, "warn");
      return { operationalError: true };
    }
    if (!track.title || track.artists.length === 0 || !track.primaryArtist) {
      saveOutcome(track, initial, "metadata_incomplete", { lastErrorCode: "MISSING_TITLE_OR_ARTIST", lastErrorMessage: "title and at least one artist are required" }, false);
      summary.permanentErrors += 1;
      emit("metadata_incomplete", "Metadata incomplete", audioPath, "warn");
      return { operationalError: false };
    }
    if (oldState && oldState.metadataHash === track.metadataHash && !isEligible(oldState, initial, now(), config.forceRecheck) && !outputExists) {
      summary.skipped += 1; return null;
    }
    if (outputExists) {
      saveOutcome(track, initial, "existing", { outputPath, completedAtMs: now() }, false);
      summary.existing += 1;
      emit("existing", "Existing sidecar preserved", audioPath);
      return { operationalError: false };
    }

    let selected: { record: ProviderLyricsRecord; score: number; operation: "exact" | "search" } | null = null;
    let exactAllowsSearch = true;
    if (track.album && track.durationSeconds !== null) {
      const exactStarted = now();
      const exact = await provider.exactLookup(track, controller.signal);
      recordProviderAttempt(track.path, "exact", exactStarted, exact, exact.status === "found" || exact.status === "instrumental" ? 1 : 0);
      if (exact.status === "found" || exact.status === "instrumental") {
        const decision = verifyExactMatch(track, exact.record, config.lyricsMaxBytes);
        if (decision.decision === "accept") {
          selected = { record: exact.record, score: decision.score, operation: "exact" };
          summary.exactMatches += 1;
        }
      } else if (exact.status !== "not_found") {
        exactAllowsSearch = false;
        return finishProviderFailure(track, initial, exact);
      }
    }

    if (!selected && exactAllowsSearch && config.searchFallback) {
      const searchStarted = now();
      const search = await provider.search(track, controller.signal);
      recordProviderAttempt(track.path, "search", searchStarted, search, search.status === "found" ? search.records.length : 0);
      if (search.status === "found") {
        const decision = decideSearchMatch(track, search.records, {
          threshold: config.scoreThreshold, ambiguityMargin: config.ambiguityMargin, lyricsMaxBytes: config.lyricsMaxBytes,
        });
        if (decision.decision === "accept") {
          selected = { record: decision.candidate.record, score: decision.score, operation: "search" };
          summary.searchMatches += 1;
        } else if (decision.decision === "ambiguous") {
          saveOutcome(track, initial, "ambiguous", { provider: provider.name, retryAfterMs: retryTime("ambiguous", now(), config.retry), lastErrorCode: "COMPETING_CANDIDATE", lastErrorMessage: "multiple candidates are within the ambiguity margin" }, true);
          summary.ambiguous += 1; emit("ambiguous", "Ambiguous candidates", audioPath); return { operationalError: false };
        }
      } else if (search.status !== "not_found") return finishProviderFailure(track, initial, search);
    }

    if (!selected) {
      saveOutcome(track, initial, "not_found", { provider: provider.name, retryAfterMs: retryTime("not_found", now(), config.retry) }, true);
      summary.notFound += 1; emit("not_found", "No acceptable synchronized lyrics", audioPath); return { operationalError: false };
    }
    if (selected.record.instrumental) {
      saveOutcome(track, initial, "instrumental", { provider: provider.name, providerRecordId: selected.record.id, matchScore: selected.score, retryAfterMs: retryTime("instrumental", now(), config.retry), completedAtMs: now() }, true);
      summary.instrumental += 1; emit("instrumental", "Instrumental track", audioPath); return { operationalError: false };
    }
    const validated = validateLrc(selected.record.syncedLyrics, { maxBytes: config.lyricsMaxBytes, durationSeconds: track.durationSeconds });
    if (!validated.valid) {
      saveOutcome(track, initial, "invalid_lyrics", { provider: provider.name, providerRecordId: selected.record.id, matchScore: selected.score, retryAfterMs: retryTime("invalid_lyrics", now(), config.retry), lastErrorCode: validated.code, lastErrorMessage: validated.message }, true);
      summary.permanentErrors += 1; emit("invalid_lyrics", "Provider lyrics failed validation", audioPath, "warn"); return { operationalError: true };
    }
    if (config.dryRun) {
      saveOutcome(track, initial, "dry_run_match", { provider: provider.name, providerRecordId: selected.record.id, matchScore: selected.score, lyricsKind: "synced", outputPath }, true);
      emit("dry_run_match", `Would create sidecar (${selected.operation} match, score ${selected.score})`, audioPath); return { operationalError: false };
    }
    const write = await writeSidecar(root, audioPath, outputPath, initial, validated.content);
    if (write.status === "written") {
      saveOutcome(track, initial, "downloaded", { provider: provider.name, providerRecordId: selected.record.id, matchScore: selected.score, lyricsKind: "synced", outputPath, completedAtMs: now() }, true);
      summary.downloaded += 1; summary.bytesWritten += write.bytes; emit("downloaded", `Created sidecar (${selected.operation} match, score ${selected.score})`, audioPath); return { operationalError: false };
    }
    if (write.status === "exists") {
      saveOutcome(track, initial, "existing", { outputPath, completedAtMs: now() }, true);
      summary.existing += 1; emit("existing", "Sidecar appeared during scan and was preserved", audioPath); return { operationalError: false };
    }
    if (write.status === "file_changed") {
      saveOutcome(track, initial, "file_changed", { retryAfterMs: now(), lastErrorCode: "FILE_CHANGED", lastErrorMessage: "audio file changed before sidecar commit" }, true);
      summary.temporaryErrors += 1; emit("file_changed", "Audio changed; sidecar not written", audioPath, "warn"); return { operationalError: true };
    }
    saveOutcome(track, initial, "write_error", { retryAfterMs: now(), lastErrorCode: write.code, lastErrorMessage: sanitizeMessage(write.message) }, true);
    summary.temporaryErrors += 1; emit("write_error", "Could not safely create sidecar", audioPath, "error"); return { operationalError: true };
  }

  function finishProviderFailure(track: TrackIdentity, snapshot: FileSnapshot, failure: Exclude<Awaited<ReturnType<LyricsProvider["exactLookup"]>>, { status: "found" | "instrumental" | "not_found" }>): { operationalError: boolean } {
    if (failure.status === "rate_limited") {
      saveOutcome(track, snapshot, "rate_limited", { provider: provider.name, retryAfterMs: failure.retryAfterMs, lastErrorCode: "RATE_LIMITED", lastErrorMessage: "provider rate limit reached" }, true);
      summary.temporaryErrors += 1; emit("rate_limited", "Provider rate limited request", track.path, "warn");
    } else if (failure.status === "invalid_response") {
      saveOutcome(track, snapshot, "invalid_response", { provider: provider.name, retryAfterMs: retryTime("invalid_response", now(), config.retry), lastErrorCode: failure.code, lastErrorMessage: sanitizeMessage(failure.message) }, true);
      summary.permanentErrors += 1; emit("invalid_response", "Invalid provider response", track.path, "warn");
    } else {
      saveOutcome(track, snapshot, "provider_error", { provider: provider.name, retryAfterMs: retryTime("provider_error", now(), config.retry), lastErrorCode: failure.code, lastErrorMessage: sanitizeMessage(failure.message) }, true);
      if (failure.status === "temporary_error") summary.temporaryErrors += 1; else summary.permanentErrors += 1;
      emit("provider_error", "Provider request failed", track.path, failure.status === "temporary_error" ? "warn" : "error");
    }
    return { operationalError: true };
  }

  function saveOutcome(track: TrackIdentity | null, snapshot: FileSnapshot, status: TrackStatus, values: Partial<TrackState>, attempted: boolean): void {
    const old = repository.get(track?.path ?? values.audioPath ?? "");
    const timestamp = now();
    repository.save({
      audioPath: track?.path ?? String(values.audioPath), rootPath: root, sizeBytes: snapshot.sizeBytes,
      modifiedAtMs: snapshot.modifiedAtMs, metadataHash: track?.metadataHash ?? old?.metadataHash ?? "",
      title: track?.title ?? old?.title ?? null, primaryArtist: track?.primaryArtist ?? old?.primaryArtist ?? null,
      album: track?.album ?? old?.album ?? null, durationSeconds: track?.durationSeconds ?? old?.durationSeconds ?? null,
      status, provider: null, providerRecordId: null, matchScore: null, lyricsKind: null, outputPath: null,
      attemptCount: old?.attemptCount ?? 0, firstSeenAtMs: old?.firstSeenAtMs ?? timestamp,
      lastCheckedAtMs: timestamp, retryAfterMs: null, completedAtMs: null, lastErrorCode: null,
      lastErrorMessage: null, appVersion: APP_VERSION, ...values,
    }, attempted);
  }

  function recordProviderAttempt(audioPath: string, operation: "exact" | "search", startedAtMs: number, outcome: { status: string; httpStatus?: number; code?: string; message?: string; record?: ProviderLyricsRecord; records?: ProviderLyricsRecord[] }, candidateCount: number): void {
    const record = outcome.record;
    const attempt: LookupAttempt = {
      audioPath, startedAtMs, completedAtMs: now(), provider: provider.name, operation, outcome: outcome.status,
      httpStatus: outcome.httpStatus ?? null, candidateCount, selectedRecordId: record?.id ?? null,
      selectedScore: null, errorCode: outcome.code ?? null,
      errorMessage: outcome.message ? sanitizeMessage(outcome.message) : null,
    };
    repository.recordAttempt(attempt);
  }

  function emit(event: string, message: string, path: string, level: "info" | "warn" | "error" = "info"): void {
    logger.event({ event: `track_${event}`, level, message, path });
  }
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

function formatSummary(summary: ScanSummary): string {
  return `Scan complete: ${summary.discovered} discovered, ${summary.eligible} eligible, ${summary.skipped} skipped, ${summary.downloaded} downloaded, ${summary.existing} existing, ${summary.instrumental} instrumental, ${summary.notFound} not found, ${summary.ambiguous} ambiguous, ${summary.temporaryErrors + summary.permanentErrors} error(s), ${summary.bytesWritten} bytes written, ${summary.providerRequests} provider request(s), ${summary.elapsedMs} ms`;
}
