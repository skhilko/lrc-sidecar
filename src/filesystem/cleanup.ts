import { readdir, lstat, rm } from "node:fs/promises";
import { join } from "node:path";

const TEMP_PATTERN = /^\.lrc-sidecar-\d+-[a-f0-9]{16}\.tmp$/u;

export async function cleanupStaleTemporaryFiles(directory: string, maxAgeMs: number, now = Date.now()): Promise<number> {
  let removed = 0;
  for (const name of await readdir(directory)) {
    if (!TEMP_PATTERN.test(name)) continue;
    const path = join(directory, name);
    const info = await lstat(path);
    if (info.isFile() && !info.isSymbolicLink() && now - info.mtimeMs >= maxAgeMs) { await rm(path); removed += 1; }
  }
  return removed;
}
