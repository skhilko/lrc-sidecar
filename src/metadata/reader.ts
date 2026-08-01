import { createHash } from "node:crypto";
import { parseFile } from "music-metadata";
import type { TrackIdentity } from "../domain/types.js";
import type { FileSnapshot } from "../discovery/stability.js";
import { strictNormalize } from "./normalize.js";

export async function readTrackIdentity(path: string, snapshot: FileSnapshot): Promise<TrackIdentity> {
  const metadata = await parseFile(path, { duration: true, skipCovers: true });
  if (!metadata.format.container) throw new Error("unsupported or malformed audio container");
  const common = metadata.common;
  const artists = uniqueStrings(common.artists ?? (common.artist ? [common.artist] : []));
  const primaryArtist = clean(common.artist ?? artists[0]);
  const identity = {
    path,
    sizeBytes: snapshot.sizeBytes,
    modifiedAtMs: snapshot.modifiedAtMs,
    title: clean(common.title),
    artists,
    primaryArtist,
    albumArtist: clean(common.albumartist),
    album: clean(common.album),
    durationSeconds: finiteOrNull(metadata.format.duration),
    trackNumber: integerOrNull(common.track.no),
    discNumber: integerOrNull(common.disk.no),
    musicBrainzRecordingId: clean(common.musicbrainz_recordingid),
    musicBrainzReleaseId: clean(common.musicbrainz_albumid),
  };
  return { ...identity, metadataHash: metadataHash(identity) };
}

function metadataHash(identity: Omit<TrackIdentity, "metadataHash">): string {
  const matchingFields = {
    title: strictNormalize(identity.title),
    artists: identity.artists.map(strictNormalize),
    primaryArtist: strictNormalize(identity.primaryArtist),
    albumArtist: strictNormalize(identity.albumArtist),
    album: strictNormalize(identity.album),
    durationSeconds: identity.durationSeconds === null ? null : Math.round(identity.durationSeconds * 1000) / 1000,
    trackNumber: identity.trackNumber,
    discNumber: identity.discNumber,
    musicBrainzRecordingId: identity.musicBrainzRecordingId,
    musicBrainzReleaseId: identity.musicBrainzReleaseId,
  };
  return createHash("sha256").update(JSON.stringify(matchingFields)).digest("hex");
}

function clean(value: string | undefined): string | null {
  const result = value?.trim();
  return result ? result : null;
}

function uniqueStrings(values: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const cleanValue = value.trim();
    const key = strictNormalize(cleanValue);
    if (cleanValue && !seen.has(key)) { result.push(cleanValue); seen.add(key); }
  }
  return result;
}

function finiteOrNull(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : null;
}

function integerOrNull(value: number | null): number | null {
  return value !== null && Number.isInteger(value) && value > 0 ? value : null;
}
