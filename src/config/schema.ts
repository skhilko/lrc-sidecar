import { UsageError } from "../domain/errors.js";
import type { AppConfig, RetryIntervals } from "./defaults.js";

const KEYS = new Set<keyof AppConfig>([
  "statePath", "lockPath", "providerOrigin", "userAgent", "searchFallback", "stabilityAgeMs",
  "metadataConcurrency", "requestDelayMs", "exactTimeoutMs", "searchTimeoutMs", "exactBodyMaxBytes",
  "searchBodyMaxBytes", "lyricsMaxBytes", "inRunRateLimitMaxMs", "scoreThreshold", "ambiguityMargin",
  "tempMaxAgeMs", "include", "exclude", "dryRun", "forceRecheck", "maxTracks", "json", "verbose",
  "quiet", "allowRoot", "allowUnsafeThreshold", "retry",
]);
const RETRY_KEYS = new Set<keyof RetryIntervals>([
  "instrumentalMs", "notFoundMs", "ambiguousMs", "invalidLyricsMs", "providerErrorMs", "invalidResponseMs",
]);

export function validateConfig(config: AppConfig): AppConfig {
  validateObjectKeys(config as unknown as Record<string, unknown>, KEYS, "configuration");
  validateObjectKeys(config.retry as unknown as Record<string, unknown>, RETRY_KEYS, "retry configuration");

  requireString(config.statePath, "statePath");
  requireString(config.lockPath, "lockPath");
  requireString(config.providerOrigin, "providerOrigin");
  requireString(config.userAgent, "userAgent");
  for (const key of ["searchFallback", "dryRun", "forceRecheck", "json", "verbose", "quiet", "allowRoot", "allowUnsafeThreshold"] as const) {
    if (typeof config[key] !== "boolean") throw new UsageError(`${key} must be a boolean`);
  }
  let origin: URL;
  try { origin = new URL(config.providerOrigin); } catch { throw new UsageError("providerOrigin must be a valid URL"); }
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) {
    throw new UsageError("providerOrigin must be a bare HTTPS origin");
  }

  boundedInteger(config.metadataConcurrency, "metadataConcurrency", 1, 32);
  boundedInteger(config.requestDelayMs, "requestDelayMs", 0, 60_000);
  boundedInteger(config.exactTimeoutMs, "exactTimeoutMs", 100, 300_000);
  boundedInteger(config.searchTimeoutMs, "searchTimeoutMs", 100, 300_000);
  boundedInteger(config.exactBodyMaxBytes, "exactBodyMaxBytes", 1_024, 10_485_760);
  boundedInteger(config.searchBodyMaxBytes, "searchBodyMaxBytes", 1_024, 52_428_800);
  boundedInteger(config.lyricsMaxBytes, "lyricsMaxBytes", 1_024, 10_485_760);
  boundedInteger(config.stabilityAgeMs, "stabilityAgeMs", 0, 86_400_000);
  boundedInteger(config.inRunRateLimitMaxMs, "inRunRateLimitMaxMs", 0, 3_600_000);
  boundedInteger(config.tempMaxAgeMs, "tempMaxAgeMs", 60_000, 604_800_000);
  boundedInteger(config.scoreThreshold, "scoreThreshold", 0, 100);
  boundedInteger(config.ambiguityMargin, "ambiguityMargin", 0, 20);
  if (config.scoreThreshold < 90 && !config.allowUnsafeThreshold) {
    throw new UsageError("scoreThreshold below 90 requires allowUnsafeThreshold");
  }
  if (config.maxTracks !== null) boundedInteger(config.maxTracks, "maxTracks", 1, 10_000_000);
  for (const [key, value] of Object.entries(config.retry)) boundedInteger(value, `retry.${key}`, 0, 31_536_000_000);
  for (const key of ["include", "exclude"] as const) {
    if (!Array.isArray(config[key]) || config[key].some((item) => typeof item !== "string" || item.length === 0)) {
      throw new UsageError(`${key} must be an array of non-empty strings`);
    }
  }
  return config;
}

export function validatePartialConfig(value: unknown): Partial<AppConfig> {
  if (!isRecord(value)) throw new UsageError("configuration file must contain a JSON object");
  validateObjectKeys(value, KEYS, "configuration");
  if (value.retry !== undefined) {
    if (!isRecord(value.retry)) throw new UsageError("retry must be an object");
    validateObjectKeys(value.retry, RETRY_KEYS, "retry configuration");
  }
  return value as Partial<AppConfig>;
}

function validateObjectKeys<T extends string>(value: Record<string, unknown>, keys: Set<T>, label: string): void {
  const unknown = Object.keys(value).filter((key) => !keys.has(key as T));
  if (unknown.length > 0) throw new UsageError(`unknown ${label} key(s): ${unknown.join(", ")}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, key: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new UsageError(`${key} must be a non-empty string`);
}

function boundedInteger(value: unknown, key: string, min: number, max: number): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new UsageError(`${key} must be an integer from ${min} through ${max}`);
  }
}
