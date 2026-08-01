import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizedTitle, relaxedNormalize, strictNormalize, tokenSimilarity } from "../../src/metadata/normalize.js";
import { hasVersionConflict } from "../../src/matching/version-conflicts.js";

describe("metadata normalization", () => {
  it("normalizes Unicode, quotes, dashes, case, and whitespace strictly", () => {
    assert.equal(strictNormalize("  Ｈello  ‘World’ — Test  "), "hello 'world' - test");
  });
  it("normalizes punctuation, ampersands, and remaster labels in relaxed mode", () => {
    assert.equal(relaxedNormalize("Rock & Roll (Remastered 2011)"), "rock and roll remaster");
  });
  it("removes a featured suffix only when artist metadata represents it", () => {
    assert.equal(normalizedTitle("Song (feat. Björk)", ["Lead", "Björk"]).relaxed, "song");
    assert.equal(normalizedTitle("Song (feat. Björk)", ["Lead"]).relaxed, "song feat björk");
  });
  it("computes token similarity", () => assert.equal(tokenSimilarity("a b c", "a b"), 0.8));
  it("preserves material version distinctions", () => {
    assert.equal(hasVersionConflict("Song (Live)", "Song"), true);
    assert.equal(hasVersionConflict("Song (Remastered)", "Song"), false);
    assert.equal(hasVersionConflict("Song (Acoustic)", "Song (Acoustic)"), false);
  });
});
