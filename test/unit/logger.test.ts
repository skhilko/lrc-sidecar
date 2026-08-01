import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLogger } from "../../src/logging/logger.js";

describe("logging", () => {
  it("emits stable JSON Lines", () => {
    let output = ""; const original = process.stdout.write; process.stdout.write = ((chunk: string | Uint8Array) => { output += String(chunk); return true; }) as typeof process.stdout.write;
    try { createLogger({ json: true, verbose: false, quiet: false }).event({ event: "test", level: "info", message: "hello", count: 1 }); } finally { process.stdout.write = original; }
    const parsed = JSON.parse(output) as Record<string, unknown>; assert.equal(parsed.event, "test"); assert.equal(parsed.count, 1); assert.equal(typeof parsed.at, "string");
  });
  it("formats human info, warning, debug, and error events", () => {
    let stdout = ""; let stderr = ""; const originalOut = process.stdout.write; const originalError = process.stderr.write;
    process.stdout.write = ((chunk: string | Uint8Array) => { stdout += String(chunk); return true; }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => { stderr += String(chunk); return true; }) as typeof process.stderr.write;
    try {
      const logger = createLogger({ json: false, verbose: true, quiet: false });
      logger.event({ event: "info", level: "info", message: "hello", path: "/song" });
      logger.event({ event: "warn", level: "warn", message: "careful" });
      logger.event({ event: "debug", level: "debug", message: "details" });
      logger.event({ event: "error", level: "error", message: "failed" });
    } finally { process.stdout.write = originalOut; process.stderr.write = originalError; }
    assert.equal(stdout, "hello /song\nWARN careful\nDEBUG details\n"); assert.equal(stderr, "ERROR failed\n");
  });
  it("suppresses debug and quiet informational events", () => {
    let output = ""; const original = process.stdout.write; process.stdout.write = ((chunk: string | Uint8Array) => { output += String(chunk); return true; }) as typeof process.stdout.write;
    try { createLogger({ json: false, verbose: false, quiet: false }).event({ event: "debug", level: "debug", message: "hidden" }); createLogger({ json: false, verbose: true, quiet: true }).event({ event: "info", level: "info", message: "hidden" }); } finally { process.stdout.write = original; }
    assert.equal(output, "");
  });
});
