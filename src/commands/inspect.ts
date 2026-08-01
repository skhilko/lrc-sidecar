import type { AppConfig } from "../config/defaults.js";
import type { Logger, LyricsProvider } from "../domain/types.js";
import { FatalError } from "../domain/errors.js";
import { snapshotRegularFile } from "../discovery/stability.js";
import { decideSearchMatch, verifyExactMatch } from "../matching/decision.js";
import { normalizedTitle, relaxedNormalize, strictNormalize } from "../metadata/normalize.js";
import { readTrackIdentity } from "../metadata/reader.js";
import { LrclibProvider } from "../providers/lrclib/client.js";

export async function runInspect(
  audioPath: string,
  offline: boolean,
  config: AppConfig,
  logger: Logger,
  provider: LyricsProvider = new LrclibProvider(config),
): Promise<void> {
  const snapshot = await snapshotRegularFile(audioPath).catch(() => null);
  if (!snapshot) throw new FatalError(`audio file is not a regular non-symlink file: ${audioPath}`);
  const track = await readTrackIdentity(audioPath, snapshot).catch((error: unknown) => { throw new FatalError(`cannot parse audio metadata: ${error instanceof Error ? error.message : String(error)}`); });
  const normalized = {
    title: track.title ? normalizedTitle(track.title, track.artists) : { strict: "", relaxed: "" },
    artists: track.artists.map((artist) => ({ original: artist, strict: strictNormalize(artist), relaxed: relaxedNormalize(artist) })),
    album: { original: track.album, strict: strictNormalize(track.album), relaxed: relaxedNormalize(track.album) },
  };
  logger.event({ event: "inspect_metadata", level: "info", message: `Metadata: ${track.primaryArtist ?? "<missing>"} — ${track.title ?? "<missing>"}`, track, normalized });
  if (offline) return;
  if (!track.title || !track.primaryArtist) throw new FatalError("title and artist are required for provider inspection", 4);
  const signal = AbortSignal.timeout(Math.max(config.exactTimeoutMs, config.searchTimeoutMs) * 4);
  if (track.album && track.durationSeconds !== null) {
    const exact = await provider.exactLookup(track, signal);
    const decision = exact.status === "found" || exact.status === "instrumental" ? verifyExactMatch(track, exact.record, config.lyricsMaxBytes) : null;
    logger.event({ event: "inspect_exact", level: "info", message: `Exact lookup: ${exact.status}${decision ? `; ${formatDecision(decision)}` : ""}`, outcome: withoutLyrics(exact), decision: decision ? withoutCandidateLyrics(decision) : null });
  }
  const search = await provider.search(track, signal);
  const decision = search.status === "found" ? decideSearchMatch(track, search.records, { threshold: config.scoreThreshold, ambiguityMargin: config.ambiguityMargin, lyricsMaxBytes: config.lyricsMaxBytes }) : null;
  logger.event({ event: "inspect_search", level: "info", message: `Search lookup: ${search.status}${decision ? `; ${formatDecision(decision)}` : ""}`, outcome: withoutLyrics(search), decision: decision ? withoutCandidateLyrics(decision) : null });
}

function formatDecision(decision: ReturnType<typeof decideSearchMatch>): string {
  if (decision.decision === "accept") return `accept record ${decision.candidate.record.id}, score ${decision.score}, reasons ${decision.reasons.join(",")}`;
  const candidates = decision.decision === "ambiguous" ? decision.candidates : decision.candidates.slice(0, 3);
  return `${decision.decision}; candidates ${candidates.map((candidate) => `${candidate.record.id}:${candidate.score}[${candidate.reasons.join(",")}]`).join(" ")}; reasons ${decision.reasons.join(",")}`;
}

function withoutLyrics<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (key, item: unknown) => key === "syncedLyrics" || key === "plainLyrics" ? (typeof item === "string" ? `<${Buffer.byteLength(item, "utf8")} bytes>` : item) : item)) as unknown;
}

function withoutCandidateLyrics<T>(value: T): unknown { return withoutLyrics(value); }
