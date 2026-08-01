import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { snapshotRegularFile } from "../../src/discovery/stability.js";
import { readTrackIdentity } from "../../src/metadata/reader.js";

const fixtures = join(process.cwd(), "test", "fixtures");
async function read(name: string) {
  const path = join(fixtures, name); const snapshot = await snapshotRegularFile(path); assert.ok(snapshot); return readTrackIdentity(path, snapshot);
}
describe("audio metadata fixtures", () => {
  it("reads FLAC Vorbis comments and Unicode", async () => {
    const track = await read("unicode.flac"); assert.equal(track.title, "Unicode Song – 夜"); assert.deepEqual(track.artists, ["Björk"]);
    assert.equal(track.album, "Fixture Album"); assert.ok(track.durationSeconds && track.durationSeconds > 0); assert.match(track.metadataHash, /^[a-f0-9]{64}$/u);
  });
  it("reads MP3 ID3v2.3 and ID3v2.4", async () => {
    assert.equal((await read("id3v23.mp3")).title, "ID3v2.3 Song"); assert.equal((await read("id3v24.mp3")).title, "ID3v2.4 Song");
  });
  it("reads iTunes-style M4A metadata", async () => assert.equal((await read("itunes.m4a")).primaryArtist, "M4A Artist"));
  it("represents missing album and artist explicitly", async () => {
    assert.equal((await read("missing-album.flac")).album, null); const missingArtist = await read("missing-artist.flac");
    assert.equal(missingArtist.primaryArtist, null); assert.deepEqual(missingArtist.artists, []);
  });
  it("rejects malformed audio", async () => assert.rejects(() => read("malformed.mp3")));
  it("produces a deterministic metadata hash", async () => assert.equal((await read("unicode.flac")).metadataHash, (await read("unicode.flac")).metadataHash));
});
