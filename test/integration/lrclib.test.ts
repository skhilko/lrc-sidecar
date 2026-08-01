import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_CONFIG, type AppConfig } from "../../src/config/defaults.js";
import type { TrackIdentity } from "../../src/domain/types.js";
import { LrclibProvider } from "../../src/providers/lrclib/client.js";

const config: AppConfig = { ...DEFAULT_CONFIG, retry: { ...DEFAULT_CONFIG.retry }, requestDelayMs: 0, inRunRateLimitMaxMs: 1_000 };
const track: TrackIdentity = { path: "/x.mp3", sizeBytes: 1, modifiedAtMs: 1, title: "A&B", artists: ["Artist"], primaryArtist: "Artist", albumArtist: null, album: "Album", durationSeconds: 10.4, trackNumber: null, discNumber: null, musicBrainzRecordingId: null, musicBrainzReleaseId: null, metadataHash: "x" };
const record = { id: 1, trackName: "A&B", artistName: "Artist", albumName: "Album", duration: 10, instrumental: false, plainLyrics: null, syncedLyrics: "[00:01]x" };
function json(value: unknown, init: ResponseInit = {}): Response { return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json", ...init.headers }, ...init }); }
function provider(fetcher: (input: Parameters<typeof fetch>[0], init?: RequestInit) => Promise<Response>): LrclibProvider { return new LrclibProvider(config, fetcher as typeof fetch); }

describe("LRCLIB client", () => {
  it("builds encoded exact parameters and validates a 200 record", async () => {
    let requested = "";
    const client = provider(async (input) => { requested = String(input); return json(record); });
    const result = await client.exactLookup(track, new AbortController().signal);
    assert.equal(result.status, "found"); assert.match(requested, /track_name=A%26B/u); assert.match(requested, /duration=10/u);
  });
  it("maps exact 404 and empty search to not found", async () => {
    const exactClient = provider(async () => new Response("", { status: 404 }));
    assert.equal((await exactClient.exactLookup(track, new AbortController().signal)).status, "not_found");
    const searchClient = provider(async () => json([]));
    assert.equal((await searchClient.search(track, new AbortController().signal)).status, "not_found");
  });
  it("validates search arrays", async () => {
    const result = await provider(async () => json([record])).search(track, new AbortController().signal);
    assert.equal(result.status, "found"); if (result.status === "found") assert.equal(result.records.length, 1);
  });
  it("rejects malformed JSON, wrong content type, oversized bodies, and redirects", async () => {
    const malformed = provider(async () => new Response("{", { headers: { "content-type": "application/json" } }));
    assert.equal((await malformed.search(track, new AbortController().signal)).status, "invalid_response");
    const wrongType = provider(async () => new Response("[]", { headers: { "content-type": "text/html" } }));
    assert.equal((await wrongType.search(track, new AbortController().signal)).status, "invalid_response");
    const oversizedConfig = { ...config, searchBodyMaxBytes: 5 };
    const oversized = new LrclibProvider(oversizedConfig, (async () => json([record])) as typeof fetch);
    assert.equal((await oversized.search(track, new AbortController().signal)).status, "invalid_response");
    const invalidUtf8 = provider(async () => new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }));
    const invalidUtf8Result = await invalidUtf8.search(track, new AbortController().signal);
    assert.equal(invalidUtf8Result.status, "invalid_response"); if (invalidUtf8Result.status === "invalid_response") assert.equal(invalidUtf8Result.code, "INVALID_UTF8");
    const redirect = provider(async () => new Response("", { status: 302, headers: { location: "https://evil.example" } }));
    assert.equal((await redirect.search(track, new AbortController().signal)).status, "permanent_error");
    const badRequest = provider(async () => new Response("", { status: 400 }));
    assert.equal((await badRequest.search(track, new AbortController().signal)).status, "permanent_error");
  });
  it("classifies instrumental and invalid records", async () => {
    assert.equal((await provider(async () => json({ ...record, instrumental: true })).exactLookup(track, new AbortController().signal)).status, "instrumental");
    assert.equal((await provider(async () => json({ ...record, duration: "bad" })).exactLookup(track, new AbortController().signal)).status, "invalid_response");
  });
  it("honors a numeric Retry-After and retries once", async () => {
    let calls = 0;
    const client = provider(async () => ++calls === 1 ? new Response("", { status: 429, headers: { "retry-after": "0" } }) : json(record));
    const result = await client.exactLookup(track, new AbortController().signal);
    assert.equal(result.status, "found"); assert.equal(calls, 2);
  });
  it("serializes concurrent operations", async () => {
    let active = 0; let maximum = 0;
    const client = provider(async () => { active += 1; maximum = Math.max(maximum, active); await new Promise((resolve) => setTimeout(resolve, 10)); active -= 1; return json(record); });
    await Promise.all([client.exactLookup(track, new AbortController().signal), client.exactLookup(track, new AbortController().signal)]);
    assert.equal(maximum, 1);
  });
});
