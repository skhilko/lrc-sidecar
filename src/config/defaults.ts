export interface RetryIntervals {
  instrumentalMs: number;
  notFoundMs: number;
  ambiguousMs: number;
  invalidLyricsMs: number;
  providerErrorMs: number;
  invalidResponseMs: number;
}

export interface AppConfig {
  statePath: string;
  lockPath: string;
  providerOrigin: string;
  userAgent: string;
  searchFallback: boolean;
  stabilityAgeMs: number;
  metadataConcurrency: number;
  requestDelayMs: number;
  exactTimeoutMs: number;
  searchTimeoutMs: number;
  exactBodyMaxBytes: number;
  searchBodyMaxBytes: number;
  lyricsMaxBytes: number;
  inRunRateLimitMaxMs: number;
  scoreThreshold: number;
  ambiguityMargin: number;
  tempMaxAgeMs: number;
  include: string[];
  exclude: string[];
  dryRun: boolean;
  forceRecheck: boolean;
  maxTracks: number | null;
  json: boolean;
  verbose: boolean;
  quiet: boolean;
  allowRoot: boolean;
  allowUnsafeThreshold: boolean;
  retry: RetryIntervals;
}

export const APP_VERSION = "0.1.0";

export const DEFAULT_CONFIG: Readonly<AppConfig> = Object.freeze({
  statePath: "/var/lib/lrc-sidecar/state.sqlite",
  lockPath: "/run/lrc-sidecar/scan.lock",
  providerOrigin: "https://lrclib.net",
  userAgent: `lrc-sidecar/${APP_VERSION} (https://github.com/skhilko/lrc-sidecar)`,
  searchFallback: true,
  stabilityAgeMs: 60_000,
  metadataConcurrency: 4,
  requestDelayMs: 300,
  exactTimeoutMs: 30_000,
  searchTimeoutMs: 20_000,
  exactBodyMaxBytes: 1_048_576,
  searchBodyMaxBytes: 5_242_880,
  lyricsMaxBytes: 1_048_576,
  inRunRateLimitMaxMs: 300_000,
  scoreThreshold: 90,
  ambiguityMargin: 3,
  tempMaxAgeMs: 86_400_000,
  include: [],
  exclude: [],
  dryRun: false,
  forceRecheck: false,
  maxTracks: null,
  json: false,
  verbose: false,
  quiet: false,
  allowRoot: false,
  allowUnsafeThreshold: false,
  retry: {
    instrumentalMs: 180 * 86_400_000,
    notFoundMs: 30 * 86_400_000,
    ambiguousMs: 30 * 86_400_000,
    invalidLyricsMs: 30 * 86_400_000,
    providerErrorMs: 86_400_000,
    invalidResponseMs: 86_400_000,
  },
});
