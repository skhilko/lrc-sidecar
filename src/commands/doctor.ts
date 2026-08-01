import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AppConfig } from "../config/defaults.js";
import type { Logger } from "../domain/types.js";
import { FatalError } from "../domain/errors.js";
import { createSidecarAtomic } from "../filesystem/atomic-writer.js";
import { acquireProcessLock } from "../filesystem/lock.js";
import { assertStateOutsideMusicRoot, validateMusicRoot } from "../filesystem/paths.js";
import { openStateDatabase } from "../state/database.js";

export async function runDoctor(musicRootInput: string, config: AppConfig, logger: Logger): Promise<void> {
  const checks: Array<{ name: string; ok: boolean; message: string }> = [];
  const version = process.versions.node.split(".").map(Number);
  const nodeOk = (version[0] ?? 0) === 24 && (version[1] ?? 0) >= 12;
  checks.push({ name: "node", ok: nodeOk, message: process.versions.node });
  if (!nodeOk) throw new FatalError("Node.js 24.12 or later in major version 24 is required");
  const root = await validateMusicRoot(musicRootInput);
  assertStateOutsideMusicRoot(root, config.statePath);
  checks.push({ name: "music_root", ok: true, message: root });

  const lock = await acquireProcessLock(config.lockPath);
  checks.push({ name: "lock", ok: true, message: config.lockPath });
  const state = await openStateDatabase(config.statePath);
  checks.push({ name: "sqlite", ok: true, message: `schema ${state.schemaVersion}` });
  state.close();

  let temporary: string | null = null;
  try {
    const testDirectory = await mkdtemp(join(dirname(config.statePath), "doctor-"));
    temporary = testDirectory;
    const audio = join(testDirectory, "probe.mp3");
    const output = join(testDirectory, "probe.lrc");
    await writeFile(audio, "doctor probe", { mode: 0o600 });
    const info = await import("node:fs/promises").then(({ stat }) => stat(audio));
    const write = await createSidecarAtomic(testDirectory, audio, output, { sizeBytes: info.size, modifiedAtMs: info.mtimeMs }, "[00:00.00]doctor probe\n");
    checks.push({ name: "atomic_write", ok: write.status === "written", message: write.status });
    if (write.status !== "written") throw new FatalError(`safe atomic finalization check failed: ${write.status}`);
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
    await lock.release();
  }

  try {
    const response = await fetch(new URL("/api/search?track_name=lrc-sidecar-doctor&artist_name=lrc-sidecar-doctor", config.providerOrigin), {
      headers: { accept: "application/json", "user-agent": config.userAgent }, redirect: "manual", signal: AbortSignal.timeout(config.searchTimeoutMs),
    });
    const ok = response.status >= 200 && response.status < 500 && response.status !== 429;
    checks.push({ name: "provider", ok, message: `HTTP ${response.status}` });
    await response.body?.cancel();
    if (!ok) throw new FatalError(`provider reachability check failed with HTTP ${response.status}`, 4);
  } catch (error) {
    if (error instanceof FatalError) throw error;
    throw new FatalError(`provider DNS/TLS/API check failed: ${error instanceof Error ? error.message : String(error)}`, 4);
  }
  checks.push({ name: "identity", ok: process.getuid?.() !== 0 || config.allowRoot, message: `uid ${process.getuid?.() ?? "unknown"}` });
  for (const check of checks) logger.event({ event: "doctor_check", level: check.ok ? "info" : "warn", message: `${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.message}`, check: check.name, ok: check.ok, detail: check.message });
}
