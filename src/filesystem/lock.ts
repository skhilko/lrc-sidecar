import { mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { FatalError } from "../domain/errors.js";

export interface ProcessLock { release(): Promise<void> }

export async function acquireProcessLock(path: string): Promise<ProcessLock> {
  await mkdir(dirname(path), { recursive: true, mode: 0o755 });
  try {
    const handle = await open(path, "wx", 0o644);
    await handle.writeFile(`${process.pid}\n`, "utf8");
    await handle.sync();
    await handle.close();
  } catch (error) {
    if (isAlreadyExists(error) && await removeStaleLock(path)) return acquireProcessLock(path);
    throw new FatalError(`cannot acquire scan lock ${path}${isAlreadyExists(error) ? " (another scan may be running)" : ""}`, 3, { cause: error });
  }
  let released = false;
  return { async release(): Promise<void> { if (!released) { released = true; await rm(path, { force: true }); } } };
}

async function removeStaleLock(path: string): Promise<boolean> {
  const text = await readFile(path, "utf8").catch(() => "");
  const pid = Number(text.trim());
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return false; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") return false;
    await rm(path);
    return true;
  }
}

function isAlreadyExists(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === "EEXIST"; }
