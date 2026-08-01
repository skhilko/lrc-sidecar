import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateLrc } from "../../src/lyrics/validate.js";

const options = { maxBytes: 1024, durationSeconds: 120 };
describe("LRC validation", () => {
  it("normalizes line endings and final newline", () => {
    const result = validateLrc("[ar:Artist]\r\n[00:01.20]Line\r\n", options);
    assert.equal(result.valid, true);
    if (result.valid) assert.equal(result.content, "[ar:Artist]\n[00:01.20]Line\n");
  });
  for (const [name, input, code] of [
    ["non-string", null, "LRC_NOT_STRING"], ["NUL", "[00:01]x\0", "LRC_NUL"],
    ["no timestamp", "hello", "LRC_NO_TIMESTAMP"], ["no text", "[00:01]", "LRC_NO_TEXT"],
    ["bad seconds", "[00:61]x", "LRC_TIMESTAMP"], ["malformed", "[00:xx]x", "LRC_TIMESTAMP"],
    ["HTML", "<html>[00:01]x</html>", "LRC_PAYLOAD"], ["past duration", "[03:00]x", "LRC_AFTER_DURATION"],
  ] as const) {
    it(`rejects ${name}`, () => {
      const result = validateLrc(input, options);
      assert.equal(result.valid, false);
      if (!result.valid) assert.equal(result.code, code);
    });
  }
  it("rejects an oversized body", () => assert.equal(validateLrc(`[00:01]${"x".repeat(2000)}`, options).valid, false));
});
