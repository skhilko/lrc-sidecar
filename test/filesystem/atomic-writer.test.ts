import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { createSidecarAtomic } from "../../src/filesystem/atomic-writer.js";
import { cleanupStaleTemporaryFiles } from "../../src/filesystem/cleanup.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))));
async function fixture(): Promise<{ root: string; audio: string; output: string; snapshot: { sizeBytes: number; modifiedAtMs: number } }> {
  const root = await mkdtemp(join(tmpdir(), "lrc-write-")); roots.push(root);
  const audio = join(root, "音楽.flac"); const output = join(root, "音楽.lrc"); await writeFile(audio, "audio");
  const info = await lstat(audio); return { root, audio, output, snapshot: { sizeBytes: info.size, modifiedAtMs: info.mtimeMs } };
}
describe("atomic sidecar writer", () => {
  it("creates a regular UTF-8 sidecar and removes its temporary file", async () => {
    const item = await fixture(); const result = await createSidecarAtomic(item.root, item.audio, item.output, item.snapshot, "[00:01]line\n");
    assert.equal(result.status, "written"); assert.equal(await readFile(item.output, "utf8"), "[00:01]line\n");
    assert.equal((await lstat(item.output)).isFile(), true);
  });
  it("never overwrites an existing sidecar", async () => {
    const item = await fixture(); await writeFile(item.output, "original");
    assert.equal((await createSidecarAtomic(item.root, item.audio, item.output, item.snapshot, "new")).status, "exists");
    assert.equal(await readFile(item.output, "utf8"), "original");
  });
  it("does not follow an output symlink", async () => {
    const item = await fixture(); const target = join(item.root, "target"); await writeFile(target, "safe"); await symlink(target, item.output);
    assert.equal((await createSidecarAtomic(item.root, item.audio, item.output, item.snapshot, "bad")).status, "exists");
    assert.equal(await readFile(target, "utf8"), "safe");
  });
  it("aborts when the audio changed", async () => {
    const item = await fixture(); await writeFile(item.audio, "changed");
    assert.equal((await createSidecarAtomic(item.root, item.audio, item.output, item.snapshot, "x")).status, "file_changed");
  });
  it("allows only one winner in a no-replace race", async () => {
    const item = await fixture(); const results = await Promise.all([
      createSidecarAtomic(item.root, item.audio, item.output, item.snapshot, "first"),
      createSidecarAtomic(item.root, item.audio, item.output, item.snapshot, "second"),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), ["exists", "written"]);
    assert.ok(["first", "second"].includes(await readFile(item.output, "utf8")));
  });
  it("rejects output path escapes, symlinked audio, and missing audio", async () => {
    const item = await fixture(); await assert.rejects(() => createSidecarAtomic(item.root, item.audio, join(item.root, "..", "escape.lrc"), item.snapshot, "x"));
    const linked = join(item.root, "linked.flac"); await symlink(item.audio, linked);
    assert.equal((await createSidecarAtomic(item.root, linked, join(item.root, "linked.lrc"), item.snapshot, "x")).status, "file_changed");
    assert.equal((await createSidecarAtomic(item.root, join(item.root, "missing.flac"), join(item.root, "missing.lrc"), item.snapshot, "x")).status, "file_changed");
  });
  it("fails closed when the output filesystem path cannot be created", async () => {
    const item = await fixture(); const result = await createSidecarAtomic(item.root, item.audio, join(item.root, "missing", "song.lrc"), item.snapshot, "x");
    assert.equal(result.status, "error"); if (result.status === "error") assert.equal(result.code, "ENOENT");
  });
  it("cleans only old application temporary files", async () => {
    const item = await fixture(); const stale = join(item.root, ".lrc-sidecar-123-0123456789abcdef.tmp"); const fresh = join(item.root, ".lrc-sidecar-123-fedcba9876543210.tmp"); const other = join(item.root, "keep.tmp");
    await writeFile(stale, "x"); await writeFile(fresh, "x"); await writeFile(other, "x"); await utimes(stale, new Date(0), new Date(0));
    assert.equal(await cleanupStaleTemporaryFiles(item.root, 1000), 1); assert.equal(await readFile(other, "utf8"), "x"); assert.equal(await readFile(fresh, "utf8"), "x");
  });
});
