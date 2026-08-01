import { lstat, link, open, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import type { FileSnapshot } from "../discovery/stability.js";
import { snapshotRegularFile, snapshotsEqual } from "../discovery/stability.js";
import { assertContained } from "./paths.js";

export type WriteResult =
  | { status: "written"; bytes: number }
  | { status: "exists" }
  | { status: "file_changed" }
  | { status: "error"; code: string; message: string };

export async function createSidecarAtomic(
  root: string,
  audioPath: string,
  outputPath: string,
  initial: FileSnapshot,
  content: string,
): Promise<WriteResult> {
  assertContained(root, audioPath);
  assertContained(root, outputPath);
  const current = await snapshotRegularFile(audioPath).catch(() => null);
  if (!current || !snapshotsEqual(initial, current)) return { status: "file_changed" };
  try { if (await pathExists(outputPath)) return { status: "exists" }; }
  catch (error) { return writeError(error); }

  const temporary = join(dirname(outputPath), `.lrc-sidecar-${process.pid}-${randomBytes(8).toString("hex")}.tmp`);
  let created = false;
  try {
    const handle = await open(temporary, "wx", 0o644);
    created = true;
    try { await handle.writeFile(content, "utf8"); await handle.sync(); }
    finally { await handle.close(); }
    const beforeLink = await snapshotRegularFile(audioPath).catch(() => null);
    if (!beforeLink || !snapshotsEqual(initial, beforeLink)) return { status: "file_changed" };
    await link(temporary, outputPath);
    await rm(temporary);
    created = false;
    const output = await lstat(outputPath);
    if (!output.isFile() || output.isSymbolicLink()) return { status: "error", code: "OUTPUT_NOT_REGULAR", message: "created sidecar is not a regular file" };
    await syncDirectory(dirname(outputPath));
    return { status: "written", bytes: Buffer.byteLength(content, "utf8") };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "WRITE_FAILED";
    if (code === "EEXIST") return { status: "exists" };
    return writeError(error);
  } finally {
    if (created) await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function writeError(error: unknown): Extract<WriteResult, { status: "error" }> {
  return { status: "error", code: (error as NodeJS.ErrnoException).code ?? "WRITE_FAILED", message: error instanceof Error ? error.message : String(error) };
}

async function pathExists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try { await handle.sync(); }
  catch (error) { if (!["EINVAL", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
  finally { await handle.close(); }
}
