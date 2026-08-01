import type { MatchReason, ProviderLyricsRecord, ScoredCandidate, TrackIdentity } from "../domain/types.js";
import { validateLrc } from "../lyrics/validate.js";
import { normalizedTitle, relaxedNormalize, strictNormalize, tokenSimilarity } from "../metadata/normalize.js";
import { hasVersionConflict } from "./version-conflicts.js";

export function scoreCandidate(track: TrackIdentity, record: ProviderLyricsRecord, lyricsMaxBytes: number): ScoredCandidate {
  const reasons: MatchReason[] = [];
  let score = 0;
  let titleApproved = false;
  let artistApproved = false;
  let durationApproved = true;
  let hardRejected = false;

  const localTitle = normalizedTitle(track.title ?? "", track.artists);
  const candidateTitle = normalizedTitle(record.trackName, splitArtists(record.artistName));
  if (localTitle.strict === candidateTitle.strict) { score += 40; reasons.push("TITLE_STRICT"); titleApproved = true; }
  else if (localTitle.relaxed === candidateTitle.relaxed) { score += 36; reasons.push("TITLE_RELAXED"); titleApproved = true; }
  else {
    const similarity = tokenSimilarity(localTitle.relaxed, candidateTitle.relaxed);
    if (similarity >= 0.9 && !hasVersionConflict(track.title ?? "", record.trackName)) {
      score += Math.min(32, Math.floor(24 + similarity * 8)); reasons.push("TITLE_SIMILAR");
    } else reasons.push("TITLE_MISMATCH");
  }

  const localArtists = [track.primaryArtist, track.albumArtist].filter((value): value is string => value !== null);
  const candidateArtists = splitArtists(record.artistName);
  if (localArtists.some((artist) => strictNormalize(artist) === strictNormalize(record.artistName))) {
    score += 30; reasons.push("ARTIST_STRICT"); artistApproved = true;
  } else if (localArtists.some((artist) => relaxedNormalize(artist) === relaxedNormalize(record.artistName))) {
    score += 27; reasons.push("ARTIST_RELAXED"); artistApproved = true;
  } else if (equivalentArtistSets(track.artists, candidateArtists)) {
    score += 27; reasons.push("ARTIST_SET"); artistApproved = true;
  } else if (localArtists.some((artist) => containsArtist(artist, record.artistName))) {
    score += 20; reasons.push("ARTIST_PARTIAL");
  } else reasons.push("ARTIST_MISMATCH");

  if (track.durationSeconds !== null && Number.isFinite(record.duration)) {
    const difference = Math.abs(track.durationSeconds - record.duration);
    if (difference <= 2) { score += 20; reasons.push("DURATION_WITHIN_2"); }
    else if (difference <= 5) { score += 15; reasons.push("DURATION_WITHIN_5"); }
    else if (difference <= 10) { score += 5; reasons.push("DURATION_WITHIN_10"); durationApproved = false; }
    else { reasons.push("DURATION_MISMATCH"); durationApproved = false; hardRejected = true; }
  }

  if (track.album && record.albumName) {
    if (strictNormalize(track.album) === strictNormalize(record.albumName)) { score += 10; reasons.push("ALBUM_STRICT"); }
    else if (relaxedNormalize(track.album) === relaxedNormalize(record.albumName)) { score += 8; reasons.push("ALBUM_RELAXED"); }
    else reasons.push("ALBUM_MISMATCH");
  }

  if (hasVersionConflict(track.title ?? "", record.trackName)) { reasons.push("VERSION_CONFLICT"); hardRejected = true; }
  if (!record.instrumental) {
    if (record.syncedLyrics === null) { reasons.push("MISSING_SYNCED_LYRICS"); hardRejected = true; }
    else if (!validateLrc(record.syncedLyrics, { maxBytes: lyricsMaxBytes, durationSeconds: track.durationSeconds }).valid) {
      reasons.push("INVALID_LRC"); hardRejected = true;
    }
  }
  return { record, score, reasons, titleApproved, artistApproved, durationApproved, hardRejected };
}

export function splitArtists(value: string): string[] {
  return value.split(/\s*(?:,|;|\s+&\s+|\s+(?:feat(?:uring)?\.?|ft\.?)\s+)\s*/iu).map((item) => item.trim()).filter(Boolean);
}

function equivalentArtistSets(left: readonly string[], right: readonly string[]): boolean {
  if (left.length === 0 || right.length === 0) return false;
  const a = new Set(left.map(relaxedNormalize));
  const b = new Set(right.map(relaxedNormalize));
  return a.size === b.size && [...a].every((artist) => b.has(artist));
}

function containsArtist(left: string, right: string): boolean {
  const a = relaxedNormalize(left);
  const b = relaxedNormalize(right);
  return a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a));
}
