import { lstat } from "node:fs/promises";

export interface FileSnapshot { sizeBytes: number; modifiedAtMs: number }

export async function snapshotRegularFile(path: string): Promise<FileSnapshot | null> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) return null;
  return { sizeBytes: info.size, modifiedAtMs: info.mtimeMs };
}

export function isOldEnough(snapshot: FileSnapshot, minimumAgeMs: number, now = Date.now()): boolean {
  return now - snapshot.modifiedAtMs >= minimumAgeMs;
}

export function snapshotsEqual(left: FileSnapshot, right: FileSnapshot): boolean {
  return left.sizeBytes === right.sizeBytes && left.modifiedAtMs === right.modifiedAtMs;
}
