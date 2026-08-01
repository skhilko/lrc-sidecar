import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { after, describe, it } from "node:test";
import { DEFAULT_CONFIG, type AppConfig } from "../../src/config/defaults.js";
import { runScan } from "../../src/commands/scan.js";
import type { Logger, LyricsProvider, ProviderLyricsRecord, TrackIdentity } from "../../src/domain/types.js";
import { createSidecarAtomic } from "../../src/filesystem/atomic-writer.js";
import { openStateDatabase } from "../../src/state/database.js";
import { StateRepository } from "../../src/state/repository.js";

const workspace = await mkdtemp(join(tmpdir(), "lrc-e2e-"));
const library = join(workspace, "library");
await import("node:fs/promises").then(({ mkdir }) => mkdir(library));
const names = ["exact", "search", "instrumental", "missing", "ambiguous", "existing", "invalid", "changed"];
for (const name of names) {
  const path = join(library, `${name}.mp3`); await writeFile(path, `audio-${name}`); await utimes(path, new Date(0), new Date(0));
}
await writeFile(join(library, "existing.lrc"), "[00:00]original\n");
const beforeHashes = await audioHashes();
after(() => rm(workspace, { recursive: true, force: true }));
const logger: Logger = { event: () => undefined };

class FakeProvider implements LyricsProvider {
  readonly name = "fake"; calls: string[] = [];
  async exactLookup(track: TrackIdentity): Promise<Awaited<ReturnType<LyricsProvider["exactLookup"]>>> {
    this.calls.push(`exact:${track.title}`);
    if (["search", "missing", "ambiguous"].includes(track.title ?? "")) return { status: "not_found" };
    return track.title === "instrumental"
      ? { status: "instrumental", record: candidate(track, 30, { instrumental: true, syncedLyrics: null }), httpStatus: 200 }
      : { status: "found", record: candidate(track, track.title === "changed" ? 80 : 10), httpStatus: 200 };
  }
  async search(track: TrackIdentity): Promise<Awaited<ReturnType<LyricsProvider["search"]>>> {
    this.calls.push(`search:${track.title}`);
    if (track.title === "missing") return { status: "not_found" };
    if (track.title === "ambiguous") return { status: "found", records: [candidate(track, 51), candidate(track, 52)], httpStatus: 200 };
    return { status: "found", records: [candidate(track, 20)], httpStatus: 200 };
  }
}

const provider = new FakeProvider();
const config: AppConfig = {
  ...DEFAULT_CONFIG, retry: { ...DEFAULT_CONFIG.retry }, statePath: join(workspace, "state.sqlite"),
  lockPath: join(workspace, "scan.lock"), stabilityAgeMs: 0, requestDelayMs: 0,
};

describe("end-to-end scan", () => {
  it("persists every outcome, writes only safe matches, and is resumable", async () => {
    const result = await runScan(library, config, logger, {
      provider,
      readMetadata: async (path, snapshot) => {
        const title = basename(path, ".mp3");
        if (title === "invalid") throw new Error("malformed audio");
        return identity(path, title, snapshot.sizeBytes, snapshot.modifiedAtMs);
      },
      writeSidecar: async (root, audio, output, snapshot, content) => basename(audio) === "changed.mp3"
        ? { status: "file_changed" as const }
        : createSidecarAtomic(root, audio, output, snapshot, content),
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.summary.downloaded, 2); assert.equal(result.summary.existing, 1);
    assert.equal(result.summary.instrumental, 1); assert.equal(result.summary.notFound, 1); assert.equal(result.summary.ambiguous, 1);
    assert.equal(await readFile(join(library, "existing.lrc"), "utf8"), "[00:00]original\n");
    assert.deepEqual(await audioHashes(), beforeHashes);
    assert.deepEqual((await readdir(library)).filter((name) => name.startsWith(".lrc-sidecar-")), []);
    for (const name of ["exact", "search"]) assert.match(await readFile(join(library, `${name}.lrc`), "utf8"), /lyrics/u);
    for (const name of ["instrumental", "missing", "ambiguous", "invalid", "changed"]) await assert.rejects(() => lstat(join(library, `${name}.lrc`)), { code: "ENOENT" });

    const state = await openStateDatabase(config.statePath, false); const repository = new StateRepository(state.database);
    const expected = { exact: "downloaded", search: "downloaded", instrumental: "instrumental", missing: "not_found", ambiguous: "ambiguous", existing: "existing", invalid: "invalid_audio", changed: "file_changed" } as const;
    for (const [name, status] of Object.entries(expected)) assert.equal(repository.get(join(library, `${name}.mp3`))?.status, status);
    state.close();

    const callsBefore = provider.calls.length;
    await runScan(library, config, logger, {
      provider,
      readMetadata: async (path, snapshot) => identity(path, basename(path, ".mp3"), snapshot.sizeBytes, snapshot.modifiedAtMs),
      writeSidecar: async () => ({ status: "file_changed" }),
    });
    assert.deepEqual(provider.calls.slice(callsBefore), ["exact:changed"]);
  });
});

function identity(path: string, title: string, sizeBytes: number, modifiedAtMs: number): TrackIdentity {
  return { path, sizeBytes, modifiedAtMs, title, artists: ["Artist"], primaryArtist: "Artist", albumArtist: "Artist", album: "Album", durationSeconds: 120, trackNumber: 1, discNumber: 1, musicBrainzRecordingId: null, musicBrainzReleaseId: null, metadataHash: `hash-${title}` };
}
function candidate(track: TrackIdentity, id: number, overrides: Partial<ProviderLyricsRecord> = {}): ProviderLyricsRecord {
  return { id, trackName: track.title!, artistName: track.primaryArtist!, albumName: track.album!, duration: track.durationSeconds!, instrumental: false, plainLyrics: null, syncedLyrics: "[00:01.00]lyrics\n", ...overrides };
}
async function audioHashes(): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of names) result[name] = createHash("sha256").update(await readFile(join(library, `${name}.mp3`))).digest("hex");
  return result;
}
