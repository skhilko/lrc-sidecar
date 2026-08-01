import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { loadConfig } from "../../src/config/load.js";
import { validateConfig } from "../../src/config/schema.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { assertContained, isContained, sidecarPath, validateMusicRoot } from "../../src/filesystem/paths.js";
import { UsageError } from "../../src/domain/errors.js";

const temporary: string[] = [];
afterEach(async () => Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))));
describe("configuration and paths", () => {
  it("applies CLI over environment over file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lrc-config-")); temporary.push(dir);
    const file = join(dir, "config.json");
    await writeFile(file, JSON.stringify({ requestDelayMs: 10, metadataConcurrency: 2 }));
    const config = await loadConfig(file, { requestDelayMs: 30 }, { LRC_SIDECAR_REQUEST_DELAY_MS: "20" });
    assert.equal(config.requestDelayMs, 30); assert.equal(config.metadataConcurrency, 2);
  });
  it("rejects unknown and unsafe configuration", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lrc-config-")); temporary.push(dir);
    const file = join(dir, "config.json"); await writeFile(file, '{"mystery":true}');
    await assert.rejects(() => loadConfig(file, {}, {}), UsageError);
    assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, scoreThreshold: 89 }), UsageError);
    assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, searchFallback: "yes" as unknown as boolean }), UsageError);
    assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, providerOrigin: "http://lrclib.net" }), UsageError);
    assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, providerOrigin: "https://lrclib.net/api" }), UsageError);
    assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, metadataConcurrency: 0 }), UsageError);
    assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, maxTracks: 0 }), UsageError);
    assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, include: [""] }), UsageError);
    assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, retry: { ...DEFAULT_CONFIG.retry, notFoundMs: -1 } }), UsageError);
  });
  it("parses and validates environment values", async () => {
    assert.equal((await loadConfig(undefined, {}, { LRC_SIDECAR_SEARCH_FALLBACK: "false", LRC_SIDECAR_ALLOW_ROOT: "1" })).searchFallback, false);
    assert.equal((await loadConfig(undefined, {}, { LRC_SIDECAR_SEARCH_FALLBACK: "true", LRC_SIDECAR_ALLOW_ROOT: "0" })).allowRoot, false);
    await assert.rejects(() => loadConfig(undefined, {}, { LRC_SIDECAR_SEARCH_FALLBACK: "maybe" }), UsageError);
    await assert.rejects(() => loadConfig(undefined, {}, { LRC_SIDECAR_REQUEST_DELAY_MS: "nope" }), UsageError);
  });
  it("derives contained sidecars and rejects escapes", () => {
    assert.equal(sidecarPath("/music", "/music/album/song.FLAC"), "/music/album/song.lrc");
    assert.equal(isContained("/music", "/music-other/song"), false);
    assert.throws(() => assertContained("/music", "/etc/passwd"));
  });
  it("canonicalizes a valid root and rejects invalid roots", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lrc-root-")); temporary.push(dir); await mkdir(join(dir, "album"));
    assert.equal(await validateMusicRoot(dir), dir);
    await assert.rejects(() => validateMusicRoot(""));
    await assert.rejects(() => validateMusicRoot(join(dir, "missing")));
    const file = join(dir, "file"); await writeFile(file, "x"); await assert.rejects(() => validateMusicRoot(file));
    await assert.rejects(() => validateMusicRoot("/"));
    assert.throws(() => sidecarPath(dir, join(dir, "no-extension")));
  });
});
