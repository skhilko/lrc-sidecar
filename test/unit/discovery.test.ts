import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { discoverAudioFiles } from "../../src/discovery/scanner.js";
import { matchesPatterns } from "../../src/discovery/exclusions.js";

const root = await mkdtemp(join(tmpdir(), "lrc-discovery-"));
after(() => rm(root, { recursive: true, force: true }));
describe("discovery", () => {
  it("supports documented prefix and glob matching", () => {
    assert.equal(matchesPatterns("Various/Album/a.mp3", ["Various"]), true);
    assert.equal(matchesPatterns("Artist/Album/a.flac", ["**/*.flac"]), true);
    assert.equal(matchesPatterns("Artist/Album/a.m4a", ["Artist/?lbum/*.m4a"]), true);
  });
  it("discovers supported regular files deterministically without symlinks", async () => {
    await mkdir(join(root, "b")); await mkdir(join(root, "a"));
    await writeFile(join(root, "b", "2.MP3"), "x"); await writeFile(join(root, "a", "1.flac"), "x");
    await writeFile(join(root, "a", "x.ogg"), "x"); await symlink(join(root, "a", "1.flac"), join(root, "a", "linked.mp3"));
    const files = await discoverAudioFiles(root, { include: [], exclude: [], maxTracks: null });
    assert.deepEqual(files, [join(root, "a", "1.flac"), join(root, "b", "2.MP3")]);
  });
});
