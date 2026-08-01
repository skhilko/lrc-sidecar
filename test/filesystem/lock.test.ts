import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { acquireProcessLock } from "../../src/filesystem/lock.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))));
describe("process lock", () => {
  it("excludes a concurrent process and releases", async () => {
    const root = await mkdtemp(join(tmpdir(), "lrc-lock-")); roots.push(root); const path = join(root, "scan.lock");
    const lock = await acquireProcessLock(path); await assert.rejects(() => acquireProcessLock(path)); await lock.release();
    const next = await acquireProcessLock(path); await next.release();
  });
  it("recovers a lock whose process no longer exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "lrc-lock-")); roots.push(root); const path = join(root, "scan.lock");
    await writeFile(path, "2147483647\n"); const lock = await acquireProcessLock(path); await lock.release();
  });
});
