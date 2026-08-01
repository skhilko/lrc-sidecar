import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { realpath, stat } from "node:fs/promises";
import { FatalError } from "../domain/errors.js";

export async function validateMusicRoot(input: string): Promise<string> {
  if (input.trim() === "") throw new FatalError("music root must not be empty");
  const root = await realpath(resolve(input)).catch(() => { throw new FatalError(`music root does not exist: ${input}`); });
  const info = await stat(root).catch(() => { throw new FatalError(`cannot stat music root: ${root}`); });
  if (!info.isDirectory()) throw new FatalError(`music root is not a directory: ${root}`);
  if (root === resolve("/")) throw new FatalError("refusing to scan filesystem root /");
  return root;
}

export function isContained(root: string, candidate: string): boolean {
  const path = relative(root, resolve(candidate));
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

export function assertContained(root: string, candidate: string): void {
  if (!isContained(root, candidate)) throw new FatalError(`path escapes music root: ${candidate}`);
}

export function sidecarPath(root: string, audioPath: string): string {
  assertContained(root, audioPath);
  const extension = extname(audioPath);
  if (!extension) throw new FatalError(`audio path has no extension: ${audioPath}`);
  const output = `${audioPath.slice(0, -extension.length)}.lrc`;
  assertContained(root, output);
  if (dirname(output) !== dirname(audioPath)) throw new FatalError(`sidecar directory differs from audio directory: ${audioPath}`);
  return output;
}

export function assertStateOutsideMusicRoot(root: string, statePath: string): void {
  if (isContained(root, statePath)) throw new FatalError("state database must be outside the music root");
}
