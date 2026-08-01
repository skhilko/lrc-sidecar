import type { AppConfig } from "../../config/defaults.js";
import type { ProviderLookupResult, ProviderSearchResult, TrackIdentity } from "../../domain/types.js";
import { sanitizeMessage } from "../../domain/errors.js";
import { parseRetryAfter, retryDelay, sleep } from "./rate-limiter.js";
import { validateLrclibRecord, validateLrclibSearch } from "./schema.js";

export interface LrclibStats { requests: number; rateLimitWaitMs: number }
type Fetch = typeof globalThis.fetch;
type RawResult =
  | { kind: "json"; value: unknown; httpStatus: number }
  | { kind: "not_found"; httpStatus: number }
  | { kind: "rate_limited"; retryAfterMs: number; httpStatus: number }
  | { kind: "temporary_error"; code: string; message: string; httpStatus?: number }
  | { kind: "permanent_error"; code: string; message: string; httpStatus?: number }
  | { kind: "invalid_response"; code: string; message: string; httpStatus?: number };

export class LrclibProvider {
  readonly name = "lrclib";
  readonly stats: LrclibStats = { requests: 0, rateLimitWaitMs: 0 };
  private queue: Promise<void> = Promise.resolve();
  private lastRequestCompletedAt = 0;
  private blockedUntil = 0;
  private readonly fetchImpl: Fetch;

  constructor(private readonly config: AppConfig, fetchImpl: Fetch = globalThis.fetch) {
    this.fetchImpl = fetchImpl;
  }

  async exactLookup(track: TrackIdentity, signal: AbortSignal): Promise<ProviderLookupResult> {
    if (!track.title || !track.primaryArtist || !track.album || track.durationSeconds === null) return { status: "not_found" };
    const url = this.endpoint("/api/get", {
      track_name: track.title,
      artist_name: track.primaryArtist,
      album_name: track.album,
      duration: String(Math.round(track.durationSeconds)),
    });
    const result = await this.enqueue(() => this.request(url, this.config.exactTimeoutMs, this.config.exactBodyMaxBytes, signal));
    if (result.kind !== "json") return mapFailure(result);
    const validation = validateLrclibRecord(result.value);
    if (!validation.valid) return { status: "invalid_response", code: "INVALID_RECORD", message: validation.message, httpStatus: result.httpStatus };
    return validation.record.instrumental
      ? { status: "instrumental", record: validation.record, httpStatus: result.httpStatus }
      : { status: "found", record: validation.record, httpStatus: result.httpStatus };
  }

  async search(track: TrackIdentity, signal: AbortSignal): Promise<ProviderSearchResult> {
    if (!track.title || !track.primaryArtist) return { status: "not_found" };
    const parameters: Record<string, string> = { track_name: track.title, artist_name: track.primaryArtist };
    if (track.album) parameters.album_name = track.album;
    const result = await this.enqueue(() => this.request(this.endpoint("/api/search", parameters), this.config.searchTimeoutMs, this.config.searchBodyMaxBytes, signal));
    if (result.kind !== "json") return mapFailure(result);
    const validation = validateLrclibSearch(result.value);
    if (!validation.valid) return { status: "invalid_response", code: "INVALID_SEARCH", message: validation.message, httpStatus: result.httpStatus };
    return validation.records.length === 0 ? { status: "not_found" } : { status: "found", records: validation.records, httpStatus: result.httpStatus };
  }

  private endpoint(path: string, parameters: Record<string, string>): URL {
    const url = new URL(path, this.config.providerOrigin);
    if (url.origin !== new URL(this.config.providerOrigin).origin || url.protocol !== "https:") throw new Error("unsafe provider URL");
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    return url;
  }

  private async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  private async request(url: URL, timeoutMs: number, maxBytes: number, signal: AbortSignal): Promise<RawResult> {
    let rateLimitRetries = 0;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.waitForThrottle(signal);
        const result = await this.singleRequest(url, timeoutMs, maxBytes, signal);
        if (result.kind === "rate_limited") {
          const delay = Math.max(0, result.retryAfterMs - Date.now());
          if (rateLimitRetries === 0 && delay <= this.config.inRunRateLimitMaxMs) {
            rateLimitRetries += 1;
            this.stats.rateLimitWaitMs += delay;
            await sleep(delay, signal);
            attempt -= 1;
            continue;
          }
          return result;
        }
        if (result.kind === "temporary_error" && attempt < 2) {
          await sleep(retryDelay(attempt), signal);
          continue;
        }
        return result;
      } catch (error) {
        if (signal.aborted) throw error;
        if (attempt < 2) { await sleep(retryDelay(attempt), signal); continue; }
        const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        return { kind: "temporary_error", code: timeout ? "HTTP_TIMEOUT" : "HTTP_NETWORK", message: sanitizeMessage(error instanceof Error ? error.message : String(error)) };
      }
    }
    return { kind: "temporary_error", code: "HTTP_RETRIES", message: "request retry limit reached" };
  }

  private async waitForThrottle(signal: AbortSignal): Promise<void> {
    const earliest = Math.max(this.blockedUntil, this.lastRequestCompletedAt + this.config.requestDelayMs);
    await sleep(Math.max(0, earliest - Date.now()), signal);
  }

  private async singleRequest(url: URL, timeoutMs: number, maxBytes: number, signal: AbortSignal): Promise<RawResult> {
    const combined = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    this.stats.requests += 1;
    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: { accept: "application/json", "user-agent": this.config.userAgent },
        redirect: "manual",
        signal: combined,
      });
      if (response.status === 404) return { kind: "not_found", httpStatus: 404 };
      if (response.status === 429) {
        const delay = parseRetryAfter(response.headers.get("retry-after")) ?? this.config.retry.providerErrorMs;
        this.blockedUntil = Math.max(this.blockedUntil, Date.now() + delay);
        return { kind: "rate_limited", retryAfterMs: this.blockedUntil, httpStatus: 429 };
      }
      if (response.status >= 500) return { kind: "temporary_error", code: "HTTP_5XX", message: `provider returned HTTP ${response.status}`, httpStatus: response.status };
      if (response.status >= 300 && response.status < 400) return { kind: "permanent_error", code: "HTTP_REDIRECT", message: "provider redirect was refused", httpStatus: response.status };
      if (!response.ok) return { kind: "permanent_error", code: "HTTP_4XX", message: `provider returned HTTP ${response.status}`, httpStatus: response.status };
      const contentType = response.headers.get("content-type")?.toLocaleLowerCase("en-US") ?? "";
      if (!contentType.includes("application/json") && !contentType.includes("+json")) {
        return { kind: "invalid_response", code: "CONTENT_TYPE", message: "provider response is not JSON", httpStatus: response.status };
      }
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return { kind: "invalid_response", code: "BODY_TOO_LARGE", message: "provider response exceeds byte limit", httpStatus: response.status };
      let text: string;
      try { text = await readBoundedBody(response, maxBytes); }
      catch (error) {
        return error instanceof BodyTooLargeError
          ? { kind: "invalid_response", code: "BODY_TOO_LARGE", message: "provider response exceeds byte limit", httpStatus: response.status }
          : { kind: "invalid_response", code: "INVALID_UTF8", message: "provider response is not valid UTF-8", httpStatus: response.status };
      }
      try { return { kind: "json", value: JSON.parse(text) as unknown, httpStatus: response.status }; }
      catch { return { kind: "invalid_response", code: "MALFORMED_JSON", message: "provider returned malformed JSON", httpStatus: response.status }; }
    } finally {
      this.lastRequestCompletedAt = Date.now();
    }
  }
}

class BodyTooLargeError extends Error {}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new BodyTooLargeError("body too large"); }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, length));
}

function mapFailure(result: Exclude<RawResult, { kind: "json" }>): ProviderLookupResult & ProviderSearchResult {
  if (result.kind === "not_found") return { status: "not_found" };
  if (result.kind === "rate_limited") return { status: "rate_limited", retryAfterMs: result.retryAfterMs };
  const httpStatus = result.httpStatus;
  const common = { code: result.code, message: result.message, ...(httpStatus === undefined ? {} : { httpStatus }) };
  if (result.kind === "temporary_error") return { status: "temporary_error", ...common };
  if (result.kind === "permanent_error") return { status: "permanent_error", ...common };
  return { status: "invalid_response", ...common };
}
