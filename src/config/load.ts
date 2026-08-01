import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DEFAULT_CONFIG, type AppConfig } from "./defaults.js";
import { validateConfig, validatePartialConfig } from "./schema.js";
import { UsageError } from "../domain/errors.js";

const ENV_KEYS: Record<string, keyof AppConfig> = {
  LRC_SIDECAR_STATE: "statePath",
  LRC_SIDECAR_LOCK: "lockPath",
  LRC_SIDECAR_PROVIDER_ORIGIN: "providerOrigin",
  LRC_SIDECAR_USER_AGENT: "userAgent",
  LRC_SIDECAR_SEARCH_FALLBACK: "searchFallback",
  LRC_SIDECAR_STABILITY_AGE_MS: "stabilityAgeMs",
  LRC_SIDECAR_METADATA_CONCURRENCY: "metadataConcurrency",
  LRC_SIDECAR_REQUEST_DELAY_MS: "requestDelayMs",
  LRC_SIDECAR_EXACT_TIMEOUT_MS: "exactTimeoutMs",
  LRC_SIDECAR_SEARCH_TIMEOUT_MS: "searchTimeoutMs",
  LRC_SIDECAR_SCORE_THRESHOLD: "scoreThreshold",
  LRC_SIDECAR_AMBIGUITY_MARGIN: "ambiguityMargin",
  LRC_SIDECAR_ALLOW_ROOT: "allowRoot",
};

export async function loadConfig(
  configPath: string | undefined,
  cli: Partial<AppConfig>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AppConfig> {
  let file: Partial<AppConfig> = {};
  if (configPath) {
    try {
      file = validatePartialConfig(JSON.parse(await readFile(resolve(configPath), "utf8")) as unknown);
    } catch (error) {
      if (error instanceof UsageError) throw error;
      throw new UsageError(`cannot load config ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const environment = parseEnvironment(env);
  const config: AppConfig = {
    ...DEFAULT_CONFIG,
    ...file,
    ...environment,
    ...cli,
    retry: { ...DEFAULT_CONFIG.retry, ...file.retry, ...environment.retry, ...cli.retry },
    include: cli.include ?? environment.include ?? file.include ?? [...DEFAULT_CONFIG.include],
    exclude: cli.exclude ?? environment.exclude ?? file.exclude ?? [...DEFAULT_CONFIG.exclude],
  };
  config.statePath = resolve(config.statePath);
  config.lockPath = resolve(config.lockPath);
  return validateConfig(config);
}

function parseEnvironment(env: NodeJS.ProcessEnv): Partial<AppConfig> {
  const result: Record<string, unknown> = {};
  for (const [envKey, configKey] of Object.entries(ENV_KEYS)) {
    const raw = env[envKey];
    if (raw === undefined) continue;
    result[configKey] = parseEnvironmentValue(raw, configKey);
  }
  return result as Partial<AppConfig>;
}

function parseEnvironmentValue(raw: string, key: keyof AppConfig): unknown {
  if (["searchFallback", "allowRoot"].includes(key)) {
    if (raw === "true" || raw === "1") return true;
    if (raw === "false" || raw === "0") return false;
    throw new UsageError(`environment value for ${key} must be true, false, 1, or 0`);
  }
  if (key.endsWith("Ms") || key === "metadataConcurrency" || key === "scoreThreshold" || key === "ambiguityMargin") {
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new UsageError(`environment value for ${key} must be numeric`);
    return value;
  }
  return raw;
}
