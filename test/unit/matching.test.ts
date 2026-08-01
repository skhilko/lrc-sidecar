import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProviderLyricsRecord, TrackIdentity } from "../../src/domain/types.js";
import { decideSearchMatch, verifyExactMatch } from "../../src/matching/decision.js";
import { scoreCandidate } from "../../src/matching/score.js";

const track: TrackIdentity = {
  path: "/music/song.flac", sizeBytes: 1, modifiedAtMs: 1, title: "Song", artists: ["Artist"],
  primaryArtist: "Artist", albumArtist: "Artist", album: "Album", durationSeconds: 120,
  trackNumber: 1, discNumber: 1, musicBrainzRecordingId: null, musicBrainzReleaseId: null, metadataHash: "hash",
};
function record(overrides: Partial<ProviderLyricsRecord> = {}): ProviderLyricsRecord {
  return { id: 1, trackName: "Song", artistName: "Artist", albumName: "Album", duration: 120,
    instrumental: false, plainLyrics: null, syncedLyrics: "[00:01]Line\n", ...overrides };
}

describe("candidate matching", () => {
  it("awards 100 for a strict match", () => {
    const scored = scoreCandidate(track, record(), 1024);
    assert.equal(scored.score, 100); assert.equal(scored.hardRejected, false);
  });
  it("scores duration bands and hard-rejects a large difference", () => {
    assert.equal(scoreCandidate(track, record({ duration: 124 }), 1024).score, 95);
    assert.equal(scoreCandidate(track, record({ duration: 128 }), 1024).score, 85);
    assert.equal(scoreCandidate(track, record({ duration: 131 }), 1024).hardRejected, true);
  });
  it("covers strict, relaxed, similar, set, partial, and mismatch signals", () => {
    assert.ok(scoreCandidate({ ...track, title: "Song!" }, record(), 1024).reasons.includes("TITLE_RELAXED"));
    const longTitle = "one two three four five six seven eight nine";
    assert.ok(scoreCandidate({ ...track, title: longTitle }, record({ trackName: `${longTitle} ten` }), 1024).reasons.includes("TITLE_SIMILAR"));
    assert.ok(scoreCandidate({ ...track, primaryArtist: "Earth, Wind & Fire", artists: ["Earth, Wind & Fire"] }, record({ artistName: "Earth Wind and Fire" }), 1024).reasons.includes("ARTIST_RELAXED"));
    assert.ok(scoreCandidate({ ...track, primaryArtist: "One / Two", albumArtist: null, artists: ["One", "Two"] }, record({ artistName: "Two & One" }), 1024).reasons.includes("ARTIST_SET"));
    assert.ok(scoreCandidate(track, record({ artistName: "Artist Orchestra" }), 1024).reasons.includes("ARTIST_PARTIAL"));
    assert.ok(scoreCandidate(track, record({ artistName: "Else" }), 1024).reasons.includes("ARTIST_MISMATCH"));
  });
  it("scores relaxed and mismatched albums and permits missing signals", () => {
    assert.ok(scoreCandidate({ ...track, album: "Album!" }, record(), 1024).reasons.includes("ALBUM_RELAXED"));
    assert.ok(scoreCandidate(track, record({ albumName: "Else" }), 1024).reasons.includes("ALBUM_MISMATCH"));
    assert.equal(scoreCandidate({ ...track, album: null, durationSeconds: null }, record(), 1024).score, 70);
  });
  it("rejects material versions, missing lyrics, and invalid lyrics but permits instrumental records", () => {
    assert.equal(scoreCandidate(track, record({ trackName: "Song (Live)" }), 1024).hardRejected, true);
    assert.equal(scoreCandidate(track, record({ syncedLyrics: null }), 1024).hardRejected, true);
    assert.ok(scoreCandidate(track, record({ syncedLyrics: "bad" }), 1024).reasons.includes("INVALID_LRC"));
    assert.equal(scoreCandidate(track, record({ instrumental: true, syncedLyrics: null }), 1024).hardRejected, false);
  });
  it("accepts a unique safe search match", () => assert.equal(decideSearchMatch(track, [record()], { threshold: 90, ambiguityMargin: 3, lyricsMaxBytes: 1024 }).decision, "accept"));
  it("marks close qualifying candidates ambiguous", () => {
    const decision = decideSearchMatch(track, [record({ id: 2 }), record({ id: 1 })], { threshold: 90, ambiguityMargin: 3, lyricsMaxBytes: 1024 });
    assert.equal(decision.decision, "ambiguous");
  });
  it("rejects empty, below-threshold, and non-approved matches", () => {
    assert.equal(decideSearchMatch(track, [], { threshold: 90, ambiguityMargin: 3, lyricsMaxBytes: 1024 }).decision, "reject");
    assert.equal(decideSearchMatch(track, [record({ artistName: "Else" })], { threshold: 90, ambiguityMargin: 3, lyricsMaxBytes: 1024 }).decision, "reject");
  });
  it("requires a two-second duration window for exact results", () => {
    assert.equal(verifyExactMatch(track, record({ duration: 122 }), 1024).decision, "accept");
    assert.equal(verifyExactMatch(track, record({ duration: 123 }), 1024).decision, "reject");
  });
});
