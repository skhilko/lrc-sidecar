import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { APP_VERSION } from "../../src/config/defaults.js";
import { openStateDatabase } from "../../src/state/database.js";
import { StateRepository } from "../../src/state/repository.js";
import type { TrackState } from "../../src/domain/types.js";

const root = await mkdtemp(join(tmpdir(), "lrc-state-"));
after(() => rm(root, { recursive: true, force: true }));
describe("SQLite state", () => {
  it("migrates, binds one root, persists state and attempts", async () => {
    const state = await openStateDatabase(join(root, "state.sqlite")); const repository = new StateRepository(state.database);
    repository.bindRoot("/music"); repository.bindRoot("/music"); assert.throws(() => repository.bindRoot("/other"));
    const row: TrackState = { audioPath: "/music/a.flac", rootPath: "/music", sizeBytes: 1, modifiedAtMs: 2, metadataHash: "h", title: "A", primaryArtist: "B", album: null, durationSeconds: 10, status: "not_found", provider: "lrclib", providerRecordId: null, matchScore: null, lyricsKind: null, outputPath: null, attemptCount: 0, firstSeenAtMs: 1, lastCheckedAtMs: 2, retryAfterMs: 3, completedAtMs: null, lastErrorCode: null, lastErrorMessage: null, appVersion: APP_VERSION };
    repository.save(row, true); repository.save({ ...row, status: "downloaded" }, true);
    assert.equal(repository.get(row.audioPath)?.attemptCount, 2); assert.equal(repository.get(row.audioPath)?.status, "downloaded");
    repository.recordAttempt({ audioPath: row.audioPath, startedAtMs: 1, completedAtMs: 2, provider: "lrclib", operation: "exact", outcome: "not_found", httpStatus: 404, candidateCount: 0, selectedRecordId: null, selectedScore: null, errorCode: null, errorMessage: null });
    assert.equal(repository.status(Date.now()).total, 1); state.close();
  });
});
