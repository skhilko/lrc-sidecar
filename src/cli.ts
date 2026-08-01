#!/usr/bin/env node
import { access } from "node:fs/promises";
import { parseArgs } from "node:util";
import type { AppConfig } from "./config/defaults.js";
import { loadConfig } from "./config/load.js";
import { runDoctor } from "./commands/doctor.js";
import { runInspect } from "./commands/inspect.js";
import { runScan } from "./commands/scan.js";
import { runStatus } from "./commands/status.js";
import { FatalError, UsageError } from "./domain/errors.js";
import { createLogger } from "./logging/logger.js";

const CONFIG_DEFAULT = "/etc/lrc-sidecar/config.json";
const common = {
  config: { type: "string" as const }, state: { type: "string" as const }, lock: { type: "string" as const },
  json: { type: "boolean" as const, default: false }, verbose: { type: "boolean" as const, default: false },
  quiet: { type: "boolean" as const, default: false }, help: { type: "boolean" as const, short: "h" as const, default: false },
  "unsafe-allow-root": { type: "boolean" as const, default: false },
};

async function main(argv: string[]): Promise<number> {
  const command = argv[0];
  if (!command || command === "help" || command === "--help" || command === "-h") { printHelp(); return 0; }
  if (!checkNodeVersion()) throw new FatalError("Node.js 24.12 or later in major version 24 is required");
  if (command === "scan") return scan(argv.slice(1));
  if (command === "inspect") return inspect(argv.slice(1));
  if (command === "status") return status(argv.slice(1));
  if (command === "doctor") return doctor(argv.slice(1));
  throw new UsageError(`unknown command: ${command}`);
}

async function scan(argv: string[]): Promise<number> {
  const parsed = parseArgs({ args: argv, allowPositionals: true, strict: true, options: {
    ...common, "dry-run": { type: "boolean", default: false }, "force-recheck": { type: "boolean", default: false },
    "max-tracks": { type: "string" }, "metadata-concurrency": { type: "string" },
    "request-delay-ms": { type: "string" }, "exact-timeout-ms": { type: "string" }, "search-timeout-ms": { type: "string" },
    include: { type: "string", multiple: true }, exclude: { type: "string", multiple: true },
    "score-threshold": { type: "string" }, "unsafe-score-threshold": { type: "boolean", default: false },
  } });
  if (parsed.values.help) { printCommandHelp("scan"); return 0; }
  if (parsed.positionals.length !== 1) throw new UsageError("usage: lrc-sidecar scan <music-root> [options]");
  const config = await commandConfig(parsed.values.config, compact({
    statePath: parsed.values.state, lockPath: parsed.values.lock, dryRun: parsed.values["dry-run"],
    forceRecheck: parsed.values["force-recheck"], maxTracks: numberOption(parsed.values["max-tracks"], "max-tracks"),
    metadataConcurrency: numberOption(parsed.values["metadata-concurrency"], "metadata-concurrency"),
    requestDelayMs: numberOption(parsed.values["request-delay-ms"], "request-delay-ms"),
    exactTimeoutMs: numberOption(parsed.values["exact-timeout-ms"], "exact-timeout-ms"),
    searchTimeoutMs: numberOption(parsed.values["search-timeout-ms"], "search-timeout-ms"),
    include: parsed.values.include, exclude: parsed.values.exclude, scoreThreshold: numberOption(parsed.values["score-threshold"], "score-threshold"),
    allowUnsafeThreshold: parsed.values["unsafe-score-threshold"], json: parsed.values.json,
    verbose: parsed.values.verbose, quiet: parsed.values.quiet, allowRoot: parsed.values["unsafe-allow-root"],
  }));
  refuseRoot(config);
  if (config.allowRoot) process.stderr.write("WARNING: unsafe root execution override enabled\n");
  const logger = createLogger(config);
  if (config.verbose) logger.event({ event: "effective_config", level: "debug", message: "Effective configuration", config });
  return (await runScan(parsed.positionals[0]!, config, logger)).exitCode;
}

async function inspect(argv: string[]): Promise<number> {
  const parsed = parseArgs({ args: argv, allowPositionals: true, strict: true, options: { ...common, offline: { type: "boolean", default: false }, "exact-timeout-ms": { type: "string" }, "search-timeout-ms": { type: "string" } } });
  if (parsed.values.help) { printCommandHelp("inspect"); return 0; }
  if (parsed.positionals.length !== 1) throw new UsageError("usage: lrc-sidecar inspect <audio-file> [--offline]");
  const config = await commandConfig(parsed.values.config, compact({ statePath: parsed.values.state, lockPath: parsed.values.lock, exactTimeoutMs: numberOption(parsed.values["exact-timeout-ms"], "exact-timeout-ms"), searchTimeoutMs: numberOption(parsed.values["search-timeout-ms"], "search-timeout-ms"), json: parsed.values.json, verbose: parsed.values.verbose, quiet: parsed.values.quiet, allowRoot: parsed.values["unsafe-allow-root"] }));
  await runInspect(parsed.positionals[0]!, parsed.values.offline, config, createLogger(config));
  return 0;
}

async function status(argv: string[]): Promise<number> {
  const parsed = parseArgs({ args: argv, allowPositionals: false, strict: true, options: common });
  if (parsed.values.help) { printCommandHelp("status"); return 0; }
  const config = await commandConfig(parsed.values.config, compact({ statePath: parsed.values.state, lockPath: parsed.values.lock, json: parsed.values.json, verbose: parsed.values.verbose, quiet: parsed.values.quiet, allowRoot: parsed.values["unsafe-allow-root"] }));
  await runStatus(config, createLogger(config)); return 0;
}

async function doctor(argv: string[]): Promise<number> {
  const parsed = parseArgs({ args: argv, allowPositionals: true, strict: true, options: common });
  if (parsed.values.help) { printCommandHelp("doctor"); return 0; }
  if (parsed.positionals.length !== 1) throw new UsageError("usage: lrc-sidecar doctor <music-root> [options]");
  const config = await commandConfig(parsed.values.config, compact({ statePath: parsed.values.state, lockPath: parsed.values.lock, json: parsed.values.json, verbose: parsed.values.verbose, quiet: parsed.values.quiet, allowRoot: parsed.values["unsafe-allow-root"] }));
  refuseRoot(config);
  if (config.allowRoot) process.stderr.write("WARNING: unsafe root execution override enabled\n");
  await runDoctor(parsed.positionals[0]!, config, createLogger(config)); return 0;
}

async function commandConfig(path: string | undefined, cli: Partial<AppConfig>): Promise<AppConfig> {
  const selected = path ?? await access(CONFIG_DEFAULT).then(() => CONFIG_DEFAULT, () => undefined);
  return loadConfig(selected, cli);
}

function compact<T extends object>(value: T): Partial<AppConfig> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<AppConfig>;
}
function numberOption(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const result = Number(value); if (!Number.isFinite(result)) throw new UsageError(`--${name} must be numeric`); return result;
}
function refuseRoot(config: AppConfig): void { if (process.getuid?.() === 0 && !config.allowRoot) throw new FatalError("refusing to run as UID 0; use --unsafe-allow-root only after reviewing the risk"); }
function checkNodeVersion(): boolean { const [major, minor] = process.versions.node.split(".").map(Number); return major === 24 && (minor ?? 0) >= 12; }
function printHelp(): void { process.stdout.write(`LRC Sidecar\n\nCommands:\n  scan <music-root>   Find and safely create synchronized lyric sidecars\n  inspect <audio>     Explain metadata and provider matching without writing\n  status              Summarize durable state\n  doctor <music-root> Check runtime, filesystem, SQLite, lock, and provider\n\nRun lrc-sidecar <command> --help for command options.\n`); }
function printCommandHelp(command: "scan" | "inspect" | "status" | "doctor"): void {
  const usage = {
    scan: "scan <music-root> [--state PATH] [--dry-run] [--force-recheck] [--max-tracks N] [--metadata-concurrency N] [--request-delay-ms N] [--exact-timeout-ms N] [--search-timeout-ms N] [--include PATTERN] [--exclude PATTERN] [--json|--verbose|--quiet]",
    inspect: "inspect <audio-file> [--offline] [--exact-timeout-ms N] [--search-timeout-ms N] [--json]",
    status: "status [--state PATH] [--json]",
    doctor: "doctor <music-root> [--state PATH] [--lock PATH] [--json]",
  }[command];
  process.stdout.write(`Usage: lrc-sidecar ${usage}\n\nCommon options: --config PATH, --state PATH, --json, --verbose, --quiet, --help\n`);
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error: unknown) => {
  const code = error instanceof UsageError ? 2 : error instanceof FatalError ? error.exitCode : 3;
  process.stderr.write(`ERROR ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = code;
});
