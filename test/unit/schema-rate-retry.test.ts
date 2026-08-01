import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRetryAfter, retryDelay, sleep } from "../../src/providers/lrclib/rate-limiter.js";
import { validateLrclibRecord, validateLrclibSearch } from "../../src/providers/lrclib/schema.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { isEligible, retryTime } from "../../src/state/retry-policy.js";
import type { TrackState } from "../../src/domain/types.js";

const valid = { id: 1, trackName: "T", artistName: "A", albumName: "B", duration: 1, instrumental: false, plainLyrics: null, syncedLyrics: "[00:00]x" };
describe("provider schema and retry policy", () => {
  it("validates exact and search records while allowing unknown fields", () => {
    assert.equal(validateLrclibRecord({ ...valid, unknown: true }).valid, true);
    assert.equal(validateLrclibSearch([valid]).valid, true);
  });
  it("rejects wrong fields and response shape", () => {
    assert.equal(validateLrclibRecord({ ...valid, id: "1" }).valid, false);
    assert.equal(validateLrclibSearch({}).valid, false);
    assert.equal(validateLrclibSearch([{ ...valid, syncedLyrics: 1 }]).valid, false);
  });
  it("parses numeric and HTTP-date Retry-After", () => {
    assert.equal(parseRetryAfter("12", 0), 12_000);
    assert.equal(parseRetryAfter("Thu, 01 Jan 1970 00:00:10 GMT", 1_000), 9_000);
    assert.equal(parseRetryAfter("bad"), null);
  });
  it("bounds retry jitter and supports abortable waits", async () => {
    assert.equal(retryDelay(0, () => 0), 800); assert.equal(retryDelay(1, () => 1), 3600); await sleep(0);
    const controller = new AbortController(); const waiting = sleep(1000, controller.signal); controller.abort(new Error("stop")); await assert.rejects(waiting, /stop/u);
    const alreadyAborted = new AbortController(); alreadyAborted.abort(); await assert.rejects(() => sleep(1, alreadyAborted.signal));
  });
  it("computes every class of status retry time", () => {
    for (const status of ["instrumental", "not_found", "ambiguous", "invalid_lyrics", "provider_error", "invalid_response"] as const) {
      assert.equal(typeof retryTime(status, 100, DEFAULT_CONFIG.retry), "number");
    }
    assert.equal(retryTime("rate_limited", 100, DEFAULT_CONFIG.retry, 555), 555);
    assert.equal(retryTime("rate_limited", 100, DEFAULT_CONFIG.retry), 100 + DEFAULT_CONFIG.retry.providerErrorMs);
    for (const status of ["write_error", "file_changed", "dry_run_match"] as const) assert.equal(retryTime(status, 100, DEFAULT_CONFIG.retry), 100);
    for (const status of ["downloaded", "existing", "metadata_incomplete", "unsupported", "invalid_audio"] as const) assert.equal(retryTime(status, 100, DEFAULT_CONFIG.retry), null);
  });
  it("makes changed and expired state eligible", () => {
    const state = { status: "not_found", sizeBytes: 1, modifiedAtMs: 2, retryAfterMs: 100 } as TrackState;
    assert.equal(isEligible(state, { sizeBytes: 1, modifiedAtMs: 2 }, 99, false), false);
    assert.equal(isEligible(state, { sizeBytes: 1, modifiedAtMs: 2 }, 100, false), true);
    assert.equal(isEligible(state, { sizeBytes: 2, modifiedAtMs: 2 }, 0, false), true);
    assert.equal(isEligible(null, { sizeBytes: 1, modifiedAtMs: 2 }, 0, false), true);
    assert.equal(isEligible(state, { sizeBytes: 1, modifiedAtMs: 2 }, 0, true), true);
    assert.equal(isEligible({ ...state, status: "write_error", retryAfterMs: null }, { sizeBytes: 1, modifiedAtMs: 2 }, 0, false), true);
    assert.equal(isEligible({ ...state, status: "downloaded", retryAfterMs: null }, { sizeBytes: 1, modifiedAtMs: 2 }, 0, false), false);
  });
});
