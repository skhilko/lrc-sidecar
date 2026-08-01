import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { DEFAULT_CONFIG, type AppConfig } from "../../src/config/defaults.js";
import { runDoctor } from "../../src/commands/doctor.js";
import { runInspect } from "../../src/commands/inspect.js";
import { runStatus } from "../../src/commands/status.js";
import type { Logger, LyricsProvider } from "../../src/domain/types.js";
import { openStateDatabase } from "../../src/state/database.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))));
function capture(): { logger: Logger; events: Record<string, unknown>[] } { const events: Record<string, unknown>[] = []; return { events, logger: { event: (event) => events.push(event) } }; }
async function setup(): Promise<{ root: string; config: AppConfig }> { const root = await mkdtemp(join(tmpdir(), "lrc-command-")); roots.push(root); return { root, config: { ...DEFAULT_CONFIG, retry: { ...DEFAULT_CONFIG.retry }, statePath: join(root, "state", "state.sqlite"), lockPath: join(root, "scan.lock"), searchTimeoutMs: 100 } }; }

describe("commands", () => {
  it("inspects fixture metadata offline without writing", async () => {
    const { config } = await setup(); const output = capture();
    const audio = join(process.cwd(), "test", "fixtures", "unicode.flac");
    await runInspect(audio, true, config, output.logger); assert.equal(output.events[0]?.event, "inspect_metadata");
  });
  it("explains exact and search decisions without logging lyric bodies", async () => {
    const { config } = await setup(); const output = capture(); const audio = join(process.cwd(), "test", "fixtures", "unicode.flac");
    const provider: LyricsProvider = { name: "fake", exactLookup: async (track) => ({ status: "found", httpStatus: 200, record: { id: 1, trackName: track.title!, artistName: track.primaryArtist!, albumName: track.album!, duration: track.durationSeconds!, instrumental: false, plainLyrics: "secret", syncedLyrics: "[00:00]secret" } }), search: async () => ({ status: "not_found" }) };
    await runInspect(audio, false, config, output.logger, provider); assert.equal(output.events.length, 3); assert.doesNotMatch(JSON.stringify(output.events), /\[00:00\]secret/u);
  });
  it("reports empty state schema and version", async () => {
    const { config } = await setup(); const state = await openStateDatabase(config.statePath); state.close(); const output = capture();
    await runStatus(config, output.logger); assert.equal(output.events[0]?.total, 0); assert.equal(output.events[0]?.schemaVersion, 1);
  });
  it("checks SQLite, locking, atomic finalization, and provider reachability", async () => {
    const { root, config } = await setup(); const music = join(root, "music"); await import("node:fs/promises").then(({ mkdir }) => mkdir(music)); const output = capture();
    const original = globalThis.fetch; globalThis.fetch = (async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    try { await runDoctor(music, config, output.logger); } finally { globalThis.fetch = original; }
    assert.equal(output.events.filter((event) => event.ok === true).length, 7);
  });
});
