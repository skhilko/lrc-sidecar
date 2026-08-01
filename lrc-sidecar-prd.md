# LRC Sidecar — Product Requirements Document

**Document status:** Draft for implementation  
**Version:** 0.2  
**Date:** 2026-07-31  
**Product name:** LRC Sidecar  
**Repository name:** `lrc-sidecar`  
**Preferred npm package name:** `lrc-sidecar`  
**CLI executable:** `lrc-sidecar`  
**Primary implementation language:** TypeScript  
**Target runtime:** Node.js 24 LTS, version 24.12 or later  

---

## 1. Executive summary

LRC Sidecar is a small, self-hosted command-line application that finds synchronized lyrics for a local music collection and writes them as `.lrc` sidecar files beside the corresponding audio files.

The application is intended to run unattended on a Linux host against a local music library used by a compatible music server such as Navidrome. It must be safer, more deterministic, and easier to maintain than adopting the existing `lrcdl` package. The implementation must never modify, rename, or delete audio files. It must prefer precision over coverage, remain resumable after interruption, avoid repeated unnecessary provider calls, and make every automatic match explainable.

The initial lyrics provider is LRCLIB. Provider-specific behavior must be isolated behind an interface so another provider can be added without redesigning the scanner, state store, matcher, or writer.

The application is a batch CLI, not a web service. It is expected to run manually for an initial library backfill and periodically through a systemd timer or equivalent scheduler.

---

## 2. Problem statement

Compatible music servers and clients, including Navidrome, can display sidecar lyrics when a correctly named `.lrc` file exists beside a track. The local music collection does not consistently include these files.

Existing download tools solve the basic lookup problem but do not provide sufficient control over:

- HTTP timeouts and retries;
- LRCLIB rate-limit compliance;
- conservative candidate matching;
- response validation;
- atomic file creation;
- durable retry state;
- differentiation between permanent and temporary failures;
- operational logging;
- filesystem safety;
- dependency and release provenance.

A custom implementation is justified because the essential workflow is small, while the required reliability and safety behavior is specific to a safety-conscious self-hosted deployment.

---

## 3. Product goals

### 3.1 Primary goals

1. **Create correct synchronized lyric sidecars**
   - Find a high-confidence synchronized lyric record for each eligible track.
   - Write the lyrics as `<audio-basename>.lrc` in the same directory as the audio file.

2. **Protect the music collection**
   - Never modify audio file contents or tags.
   - Never rename, move, truncate, or delete an audio file.
   - Never overwrite an existing `.lrc` file during a normal scan.
   - Never leave a partially written final `.lrc` file.

3. **Favor precision over recall**
   - Automatically write only when the match passes conservative acceptance rules.
   - Record ambiguous candidates for inspection rather than guessing.

4. **Operate reliably without supervision**
   - Resume safely after process interruption, host reboot, network failure, or provider failure.
   - Persist lookup outcomes and retry times.
   - Respect provider throttling and `Retry-After`.

5. **Remain simple and maintainable**
   - Use TypeScript with strict compiler settings.
   - Minimize runtime dependencies.
   - Keep provider, matching, state, and filesystem behavior independently testable.

6. **Provide transparent operation**
   - Produce useful human-readable output by default.
   - Support structured JSON Lines output.
   - Record why each track was downloaded, skipped, deferred, or rejected.

### 3.2 Success metrics

The MVP is successful when:

- no audio file checksum changes during an end-to-end test;
- no existing `.lrc` file changes during a normal scan;
- every created `.lrc` file passes the local validator;
- an interrupted scan can be rerun without manual cleanup;
- LRCLIB requests are sequential and throttled;
- a `429` response delays further calls according to `Retry-After`;
- low-confidence or closely competing candidates are not written automatically;
- a second unchanged scan performs no unnecessary provider requests for tracks still inside their retry window;
- all critical safety and matching tests pass.

---

## 4. Non-goals

The MVP will not:

- generate synchronized timestamps from audio;
- scrape lyric websites;
- publish or edit records in LRCLIB;
- modify embedded lyrics or other audio metadata;
- rename or reorganize music files;
- delete stale or incorrect sidecars automatically;
- provide a browser UI or long-running HTTP server;
- watch the filesystem continuously;
- translate lyrics;
- merge lyrics from multiple providers;
- provide multi-user authorization;
- expose a Navidrome plugin API;
- guarantee lyrics for every track;
- automatically accept weak fuzzy matches to maximize coverage.

Plain, unsynchronized lyrics are not written by default. They may be added later behind an explicit configuration option after client behavior is confirmed.

---

## 5. Users and primary use cases

### 5.1 Primary user

The primary user is the owner or operator of a self-hosted music collection or music server.

### 5.2 Use cases

#### UC-1: Initial library backfill

The operator runs a recursive scan over the entire music root. The application finds synchronized lyrics, creates safe sidecars, and records all outcomes.

#### UC-2: Scheduled incremental scan

A systemd timer runs the same command periodically. Unchanged completed tracks are skipped. Newly added or modified tracks are evaluated. Temporary failures and expired negative results are retried.

#### UC-3: Dry-run assessment

The operator runs a scan without writing sidecars. The application reports what it would create and records no completed download state unless explicitly requested.

#### UC-4: Inspect a problematic track

The operator asks the application to parse one track, show normalized metadata, query candidates, explain their scores, and make no write.

#### UC-5: Review overall state

The operator requests counts by status, upcoming retries, recent errors, and the number of tracks with downloaded lyrics.

---

## 6. Product principles

1. **Safety before convenience**
2. **Precision before coverage**
3. **Idempotency before speed**
4. **Explicit states instead of overloaded exceptions**
5. **No hidden mutation**
6. **Provider behavior isolated from core behavior**
7. **No lyrics content in routine logs**
8. **Fail closed when write safety cannot be guaranteed**

---

## 7. Operating assumptions and constraints

- Primary deployment target: Linux, with Debian as the first-class tested environment.
- Music may be stored on a locally mounted or network-mounted filesystem.
- A music server such as Navidrome should continue to mount the music collection read-only.
- LRC Sidecar runs as a dedicated unprivileged user with only the write permissions required to create sidecars.
- The application runs as a one-shot process.
- A single state database is associated with a configured music root.
- Only one scan process may operate on a state database at a time.
- Outbound HTTPS access to the configured provider is available.
- The music library is mostly FLAC, with possible MP3 and M4A files.
- Filenames and metadata may contain arbitrary Unicode.

---

## 8. Technical product decisions

These are product-level constraints for the implementation.

### 8.1 Runtime and module system

- TypeScript compiled to JavaScript before deployment.
- Node.js 24 LTS, version 24.12 or later.
- Native ECMAScript modules.
- `strict: true` in TypeScript.
- Production execution uses `node dist/cli.js`, not an on-the-fly TypeScript runtime.

### 8.2 Runtime dependencies

The intended essential third-party runtime dependency is:

- `music-metadata` for audio metadata and duration extraction.

Prefer Node built-ins for:

- HTTP: global `fetch`;
- timeouts: `AbortSignal.timeout` or an equivalent composed signal;
- CLI parsing: `node:util` `parseArgs`;
- filesystem: `node:fs/promises`;
- hashing: `node:crypto`;
- state: `node:sqlite`;
- test runner: `node:test`, unless a separate development-only test framework is deliberately selected.

A new runtime dependency requires a concrete benefit and should not duplicate an adequate Node built-in.

### 8.3 SQLite

- Use `node:sqlite`.
- Extension loading must remain disabled.
- Enable SQLite defensive mode when supported.
- Use prepared statements for all data values.
- Use a schema version table and explicit migrations.
- The database is local application state and must not be placed inside the music tree by default.

### 8.4 Canonical naming

All implementation, packaging, deployment, and documentation artifacts should use the following names consistently:

| Component | Canonical name |
|---|---|
| Product display name | LRC Sidecar |
| Repository | `lrc-sidecar` |
| Preferred npm package | `lrc-sidecar` (verify registry availability before publishing) |
| CLI executable | `lrc-sidecar` |
| Service account | `lrc-sidecar` |
| systemd service unit | `lrc-sidecar.service` |
| systemd timer unit | `lrc-sidecar.timer` |
| Configuration directory | `/etc/lrc-sidecar/` |
| Configuration file | `/etc/lrc-sidecar/config.json` |
| State directory | `/var/lib/lrc-sidecar/` |
| State database | `/var/lib/lrc-sidecar/state.sqlite` |
| Runtime directory | `/run/lrc-sidecar/` |
| Process lock | `/run/lrc-sidecar/scan.lock` |
| Environment-variable prefix | `LRC_SIDECAR_` |
| Log/syslog identifier | `lrc-sidecar` |
| Preferred OCI image name | `lrc-sidecar` |

Names containing a registry owner, organization, or package scope may add that namespace while preserving `lrc-sidecar` as the project identifier.

---

## 9. Functional requirements

### FR-1: Music-root validation

The application must:

1. Resolve the configured music root to an absolute canonical path.
2. Verify that it exists and is a directory.
3. Refuse to scan `/` or an empty path.
4. Verify that the state database is not located inside an audio album directory unless explicitly configured.
5. Confirm that all derived sidecar paths remain inside the configured root.
6. Refuse to run as UID 0 by default.
7. Permit a deliberate root override only through an explicit unsafe option, with a visible warning.

### FR-2: File discovery

The scanner must:

- recurse through the configured root;
- use case-insensitive extension matching;
- support these MVP extensions:
  - `.flac`
  - `.mp3`
  - `.m4a`
- not follow directory symlinks by default;
- not process symlinked audio files by default;
- expose an explicit future option for trusted symlink traversal rather than silently enabling it;
- skip non-regular files;
- skip temporary files;
- derive the output by replacing the final extension with `.lrc`;
- not treat an existing sidecar as valid solely because its name exists; record its presence and optionally validate it;
- avoid holding more than the configured number of audio files open concurrently;
- produce deterministic discovery behavior for a stable directory tree.

The scanner should support exclusion patterns configured as relative path prefixes or glob-like patterns. The implementation must document the exact matching semantics.

### FR-3: File stability check

Before processing a track, the application must read file size and modification time.

The application must skip or defer files that appear to be actively copied or modified. Default behavior:

- require the file modification time to be at least 60 seconds old;
- capture size and modification time before metadata parsing;
- check them again before committing a sidecar;
- abort that track if either value changed.

The stability interval must be configurable.

### FR-4: Metadata extraction

Use `music-metadata` through direct file parsing.

The parser must request:

- title;
- artist or artists;
- album;
- album artist when available;
- duration;
- track number;
- disc number;
- MusicBrainz recording and release identifiers when available;
- native tags only when needed for fallback normalization.

The parser must skip embedded cover art.

The normalized internal identity must include:

```ts
interface TrackIdentity {
  path: string;
  sizeBytes: number;
  modifiedAtMs: number;
  title: string | null;
  artists: string[];
  primaryArtist: string | null;
  albumArtist: string | null;
  album: string | null;
  durationSeconds: number | null;
  trackNumber: number | null;
  discNumber: number | null;
  musicBrainzRecordingId: string | null;
  musicBrainzReleaseId: string | null;
  metadataHash: string;
}
```

The metadata hash must be deterministic and include the normalized fields that affect matching. It must change when relevant metadata or duration changes.

Minimum metadata requirements:

- title is required;
- at least one artist value is required;
- duration is required for exact LRCLIB lookup;
- album is required for exact LRCLIB lookup;
- missing album or duration may still permit search fallback, but only under stricter acceptance rules.

If title or artist is absent, assign `metadata_incomplete` and do not query the provider.

### FR-5: Metadata normalization

Normalization must preserve original values and derive separate comparison values.

#### Strict normalization

Strict normalization must:

- apply Unicode NFKC normalization;
- trim leading and trailing whitespace;
- collapse repeated internal whitespace;
- convert typographic apostrophes and quotation marks to stable comparison forms;
- normalize common dash characters;
- compare case-insensitively.

#### Relaxed normalization

Relaxed normalization may additionally:

- remove punctuation that does not distinguish words;
- normalize `&` and `and`;
- remove an explicit `feat.`, `featuring`, or `ft.` suffix from the track title when the same featured artist is already represented in artist metadata;
- normalize clearly equivalent remaster labels.

Relaxed normalization must not blindly remove:

- `live`;
- `acoustic`;
- `instrumental`;
- `remix`;
- language labels;
- version names;
- movement numbers;
- mix names.

Those terms can represent a materially different recording.

Normalization rules must be unit-tested with real library examples.

### FR-6: Provider abstraction

The core application must depend on a provider interface rather than LRCLIB directly.

```ts
interface LyricsProvider {
  readonly name: string;

  exactLookup(
    track: TrackIdentity,
    signal: AbortSignal
  ): Promise<ProviderLookupResult>;

  search(
    track: TrackIdentity,
    signal: AbortSignal
  ): Promise<ProviderSearchResult>;
}
```

Provider results must use discriminated unions. Expected outcomes include:

- `found`;
- `not_found`;
- `instrumental`;
- `rate_limited`;
- `temporary_error`;
- `permanent_error`;
- `invalid_response`.

Exceptions are reserved for programmer errors and truly unexpected failures. Normal provider outcomes must be represented as values.

### FR-7: LRCLIB exact lookup

The LRCLIB provider must use:

`GET /api/get`

with:

- `track_name`;
- `artist_name`;
- `album_name`;
- rounded duration in seconds.

Exact lookup is attempted only when all required values are present.

The response must still be locally validated. A successful HTTP response does not automatically authorize a write.

A 404 maps to `not_found`.

### FR-8: LRCLIB search fallback

When exact lookup returns `not_found`, or cannot be attempted due to missing album or duration, the provider may use:

`GET /api/search`

with field-specific parameters when possible:

- `track_name`;
- `artist_name`;
- `album_name`.

Use the broad `q` parameter only as a final fallback and only when field-specific search is not viable.

The provider currently returns at most 20 records. The application must not assume this limit is permanent.

Search fallback must be configurable and enabled by default.

### FR-9: HTTP client behavior

Every LRCLIB request must:

- use HTTPS;
- identify the application with a compliant `User-Agent`;
- use `URL` and `URLSearchParams`, not string concatenation;
- reject redirects by default;
- permit only the configured provider origin;
- set an overall request timeout;
- accept only a successful JSON response with a plausible JSON content type;
- enforce a maximum response-body size;
- validate parsed JSON before use.

Default limits:

- exact lookup timeout: 30 seconds;
- search timeout: 20 seconds;
- exact response maximum: 1 MiB;
- search response maximum: 5 MiB.

The response reader must stop and fail if the configured byte limit is exceeded.

### FR-10: Throttling and retries

LRCLIB requests must be sequential. Provider concurrency is exactly one.

After one request completes, wait a default of 300 ms before beginning the next request.

For HTTP `429`:

- parse `Retry-After`;
- support both integer-seconds and HTTP-date formats;
- do not send another provider request before the delay expires;
- persist a future retry time;
- retry the current request at most once during the same run when the wait is no more than the configured in-run maximum;
- default in-run maximum wait: 300 seconds.

For timeouts, connection failures, and HTTP `5xx`:

- retry at most two times;
- use bounded exponential backoff with jitter;
- default delays approximately 1 second and 3 seconds;
- do not retry indefinitely.

For non-404 HTTP `4xx`:

- do not retry automatically unless explicitly classified;
- record `permanent_error` or `invalid_response`.

### FR-11: LRCLIB response validation

A lyric record must be accepted only if the response contains valid types for:

- `id`;
- `trackName`;
- `artistName`;
- `albumName`;
- `duration`;
- `instrumental`;
- `plainLyrics`;
- `syncedLyrics`.

Nullable lyric fields must be handled explicitly.

Unknown fields are allowed.

Invalid records must not crash the scan. They must produce `invalid_response`.

The application must never log the complete lyric body as part of ordinary error handling.

### FR-12: Candidate scoring

Search results must be scored locally.

Recommended score, totaling 100:

| Signal | Maximum |
|---|---:|
| Title | 40 |
| Artist | 30 |
| Duration | 20 |
| Album | 10 |

#### Title score

- strict normalized equality: 40;
- relaxed normalized equality: 36;
- very high token similarity with no conflicting version label: up to 32;
- otherwise: 0–31.

#### Artist score

- strict normalized equality with primary artist or album artist: 30;
- relaxed normalized equality: 27;
- equivalent multi-artist set: up to 27;
- partial containment alone: no more than 20.

#### Duration score

- difference no greater than 2 seconds: 20;
- difference no greater than 5 seconds: 15;
- difference no greater than 10 seconds: 5;
- greater than 10 seconds: hard rejection when both durations are known.

#### Album score

- strict normalized equality: 10;
- relaxed normalized equality: 8;
- missing local or provider album: 0;
- mismatch: 0.

#### Hard acceptance conditions

A search result may be automatically accepted only when all are true:

1. score is at least 90;
2. title is a strict or approved relaxed match;
3. artist is a strict or approved relaxed match;
4. duration differs by no more than 5 seconds when both durations are known;
5. no material version conflict exists;
6. synchronized lyrics pass local validation;
7. the second-best candidate is not within 3 points of the top candidate.

If the top two candidates are within 3 points and both otherwise qualify, classify the result as `ambiguous`.

The score threshold and ambiguity margin must be configurable, but lowering the threshold below the safe default must require an explicit option.

### FR-13: Exact-result verification

A record returned by `/api/get` must pass:

- title strict or relaxed equality;
- artist strict or relaxed equality;
- duration difference no greater than 2 seconds;
- no material version conflict;
- synchronized lyric validation.

The endpoint’s own match selection is not sufficient by itself.

### FR-14: Instrumental records

When LRCLIB reports `instrumental: true`:

- store `instrumental`;
- do not create an empty `.lrc`;
- do not treat it as an error;
- retry only after the configured long retry interval or when metadata changes.

Default instrumental retry interval: 180 days.

### FR-15: Synchronized lyric validation

The MVP writes only `syncedLyrics`.

The validator must:

- require a string;
- enforce a configurable maximum byte size, default 1 MiB;
- reject NUL bytes;
- normalize line endings to LF;
- preserve meaningful Unicode;
- require at least one valid LRC timestamp;
- require non-empty lyric text after timestamp and metadata tags are excluded;
- reject obviously malformed timestamp syntax;
- reject a maximum timestamp more than 30 seconds beyond known track duration;
- reject embedded HTML documents or provider error payloads;
- ensure the final file ends with one newline.

Metadata lines such as `[ar:]`, `[al:]`, `[ti:]`, `[by:]`, and `[offset:]` may be retained.

The application must not silently reorder or retime lyric lines.

### FR-16: Existing sidecar behavior

Default behavior:

- never overwrite an existing `.lrc`;
- classify it as `existing`;
- do not query the provider when the audio file and sidecar state are unchanged.

Optional validation mode may inspect an existing `.lrc`.

Invalid existing sidecars must be reported but not replaced automatically.

A future explicit repair command may write a replacement only after preserving the original with a deterministic backup name. Repair is outside MVP scope.

### FR-17: Atomic sidecar creation

The writer must:

1. derive the final sidecar path inside the music root;
2. verify the audio file is still stable;
3. verify the final path does not exist;
4. create a unique temporary file in the same directory using exclusive creation;
5. write UTF-8 content;
6. flush the file to disk;
7. atomically create the final path without replacing an existing path;
8. remove the temporary file;
9. flush the parent directory when practical;
10. verify the final file is a regular file.

Preferred Linux finalization:

- create the temporary file;
- use a same-filesystem hard link from the temporary path to the final path;
- fail if the final path already exists;
- unlink the temporary path.

If the filesystem does not support a safe no-replace finalization mechanism, the writer must fail closed. It must not fall back to an operation that can overwrite an existing sidecar.

Default file mode: `0644`, subject to the process umask.

Temporary files left by a crash must be identifiable and safely removable on a later run only when they match the application’s naming pattern and are older than a configured age.

### FR-18: State persistence

The application must persist track state in SQLite.

Recommended primary table:

```sql
CREATE TABLE track_state (
  audio_path TEXT PRIMARY KEY,
  root_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  modified_at_ms INTEGER NOT NULL,
  metadata_hash TEXT NOT NULL,

  title TEXT,
  primary_artist TEXT,
  album TEXT,
  duration_seconds REAL,

  status TEXT NOT NULL,
  provider TEXT,
  provider_record_id INTEGER,
  match_score REAL,
  lyrics_kind TEXT,
  output_path TEXT,

  attempt_count INTEGER NOT NULL DEFAULT 0,
  first_seen_at_ms INTEGER NOT NULL,
  last_checked_at_ms INTEGER,
  retry_after_ms INTEGER,
  completed_at_ms INTEGER,
  last_error_code TEXT,
  last_error_message TEXT,
  app_version TEXT NOT NULL
) STRICT;
```

A separate attempt-history table is recommended:

```sql
CREATE TABLE lookup_attempt (
  id INTEGER PRIMARY KEY,
  audio_path TEXT NOT NULL,
  started_at_ms INTEGER NOT NULL,
  completed_at_ms INTEGER NOT NULL,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  outcome TEXT NOT NULL,
  http_status INTEGER,
  candidate_count INTEGER,
  selected_record_id INTEGER,
  selected_score REAL,
  error_code TEXT,
  error_message TEXT
) STRICT;
```

Do not store full lyric bodies in SQLite.

### FR-19: Track statuses

Required statuses:

- `downloaded`
- `existing`
- `instrumental`
- `not_found`
- `ambiguous`
- `metadata_incomplete`
- `unsupported`
- `invalid_audio`
- `invalid_lyrics`
- `provider_error`
- `rate_limited`
- `invalid_response`
- `write_error`
- `file_changed`
- `dry_run_match`

Status values must be represented as a TypeScript union and validated when read from SQLite.

### FR-20: Retry policy

Default retry behavior:

| Status | Default retry |
|---|---|
| `downloaded` | only when metadata changes or output disappears |
| `existing` | only when metadata or output changes |
| `instrumental` | 180 days |
| `not_found` | 30 days |
| `ambiguous` | 30 days or metadata change |
| `metadata_incomplete` | metadata change |
| `invalid_audio` | file change |
| `invalid_lyrics` | 30 days |
| `provider_error` | 24 hours |
| `rate_limited` | provider `Retry-After` |
| `invalid_response` | 24 hours |
| `write_error` | next run |
| `file_changed` | next run |

Retry intervals must be configurable.

A metadata-hash change invalidates prior negative and ambiguous results.

### FR-21: Idempotency

For unchanged inputs and state, repeated scans must not:

- rewrite a sidecar;
- re-query a provider before retry eligibility;
- increment failure counters merely because a track is skipped;
- change a completed result.

A scan may safely be restarted after any individual track.

### FR-22: Process locking

Only one process may use a given state database for a write scan.

The application must acquire an exclusive process lock at `/run/lrc-sidecar/scan.lock` before scanning. Failure to acquire the lock must produce a clear fatal error rather than allowing concurrent writers.

Read-only status operations may run concurrently if SQLite permits them safely.

### FR-23: CLI commands

#### `lrc-sidecar scan <music-root>`

Performs a recursive scan.

Required options:

- `--state <path>`
- `--dry-run`
- `--force-recheck`
- `--max-tracks <number>`
- `--metadata-concurrency <number>`
- `--request-delay-ms <number>`
- `--exact-timeout-ms <number>`
- `--search-timeout-ms <number>`
- `--include <pattern>`
- `--exclude <pattern>`
- `--json`
- `--verbose`
- `--quiet`

Safe defaults must be used when options are omitted.

#### `lrc-sidecar inspect <audio-file>`

Must:

- parse metadata;
- show strict and relaxed normalized values;
- perform exact and search lookups unless `--offline` is specified;
- list candidate scores and rejection reasons;
- validate any selected synchronized lyrics;
- never write a sidecar;
- not alter durable track state by default.

#### `lrc-sidecar status`

Must show:

- total known tracks;
- counts by status;
- recent successful downloads;
- recent errors;
- retry-eligible counts;
- next scheduled retry time;
- state database schema and application version.

Support `--json`.

#### `lrc-sidecar doctor <music-root>`

Must check:

- Node version;
- state directory creation and locking;
- SQLite initialization;
- music-root readability;
- representative sidecar write capability without touching audio;
- safe atomic finalization capability;
- provider DNS, TLS, and API reachability;
- configured user identity and root warning.

The write check must use an application-owned temporary test directory or a deliberately selected writable directory. It must not place test artifacts in arbitrary album directories without explicit approval.

### FR-24: Configuration

Configuration precedence:

1. CLI arguments
2. environment variables
3. JSON configuration file
4. built-in defaults

Environment variables use the `LRC_SIDECAR_` prefix.

No secrets are required for LRCLIB.

The configuration parser must:

- reject unknown keys by default;
- reject invalid types and unsafe ranges;
- print the effective non-sensitive configuration in verbose mode;
- support a `--config <path>` option.

Recommended default configuration location:

`/etc/lrc-sidecar/config.json`

Recommended state location:

`/var/lib/lrc-sidecar/state.sqlite`

### FR-25: Output and logging

Default output is concise, human-readable text.

Each processed track should produce at most one normal summary line unless verbose mode is enabled.

Required final summary:

- discovered;
- eligible;
- skipped;
- exact matches;
- search matches;
- downloaded;
- existing;
- instrumental;
- not found;
- ambiguous;
- temporary errors;
- permanent errors;
- bytes written;
- provider requests;
- rate-limit wait time;
- elapsed time.

JSON mode must emit JSON Lines with stable event names.

Logs must not include:

- full lyrics;
- audio contents;
- environment dumps;
- arbitrary response bodies;
- secrets if another provider is added later.

Error messages may include short, size-limited provider messages after control characters are removed.

### FR-26: Exit codes

- `0`: scan completed with no operational errors; not-found, instrumental, and ambiguous results are valid outcomes.
- `1`: scan completed but one or more tracks had temporary, validation, or write errors.
- `2`: invalid command-line arguments or configuration.
- `3`: fatal initialization, database, lock, or filesystem error.
- `4`: fatal provider configuration or connectivity error before useful work could begin.

A single malformed audio file must not terminate the complete scan.

### FR-27: Privacy

The application must document that LRCLIB receives:

- title;
- artist;
- album when available;
- duration;
- source IP address;
- application user-agent.

The application must not upload:

- audio file content;
- filesystem paths;
- Navidrome credentials;
- the state database.

No telemetry or analytics may be added by default.

---

## 10. Security requirements

### SR-1: Least privilege

- Refuse root execution by default.
- Deployment instructions must use a dedicated service account.
- The application must require only read access to audio files and create access for sidecars.
- Navidrome remains a separate read-only consumer.

### SR-2: No command execution

The application must not invoke a shell, external tag utility, or subprocess for normal operation.

### SR-3: Path safety

- Use path APIs, not manual separator concatenation.
- Resolve and verify containment under the music root.
- Re-check file type and symlink state before writing.
- Never derive output directories from provider data.
- Provider metadata must not influence the output filename.

### SR-4: Network safety

- HTTPS only.
- Same-origin redirects are disabled by default; cross-origin redirects are never followed automatically.
- Limit response sizes.
- Apply timeouts.
- Validate all JSON.
- Do not interpolate provider strings into logs without sanitization.

### SR-5: Database safety

- Prepared statements only.
- Extension loading disabled.
- Defensive mode enabled.
- Migrations wrapped in transactions.
- State corruption must fail clearly; do not recreate or discard the database automatically.

### SR-6: Supply-chain safety

- Commit a lockfile.
- Pin the Node major version.
- Use reproducible CI installation.
- Keep runtime dependencies minimal.
- Enable automated dependency update review.
- Run dependency vulnerability checks in CI.
- Do not execute lifecycle scripts from unnecessary packages in production builds where avoidable.

### SR-7: Sidecar integrity

- Atomic no-replace creation.
- UTF-8 output.
- Local lyric validation before write.
- Revalidate target absence immediately before finalization.
- No automatic replacement or deletion.

---

## 11. Non-functional requirements

### NFR-1: Reliability

- Per-track failures are isolated.
- State is committed after each track outcome.
- A process crash loses at most the current track’s uncommitted state.
- Temporary files never become valid sidecars without a completed atomic finalization.
- Database transactions remain short.

### NFR-2: Resource bounds

Default limits:

- metadata concurrency: 4;
- provider concurrency: 1;
- open audio files: no more than metadata concurrency;
- exact body: 1 MiB;
- search body: 5 MiB;
- lyric body: 1 MiB;
- bounded in-memory work queue;
- no full audio file buffering.

### NFR-3: Portability

MVP support is Linux on common local and network filesystems.

The application should avoid unnecessary Linux-only assumptions outside the atomic writer and service packaging. Unsupported safe-write behavior must produce a clear diagnostic.

### NFR-4: Maintainability

- Strict TypeScript.
- No `any` at external boundaries.
- Runtime validation for provider JSON and SQLite status values.
- Small modules with explicit interfaces.
- Matching decisions return reason codes, not only scores.
- Public functions used by the CLI have unit tests.

### NFR-5: Observability

- Stable event names.
- Error codes distinct from human messages.
- Match score and provider record ID retained in state.
- Complete lyric text excluded from logs and state.

---

## 12. Recommended module boundaries

```text
src/
  cli.ts
  commands/
    scan.ts
    inspect.ts
    status.ts
    doctor.ts
  config/
    defaults.ts
    load.ts
    schema.ts
  discovery/
    scanner.ts
    exclusions.ts
    stability.ts
  metadata/
    reader.ts
    normalize.ts
    identity.ts
  providers/
    provider.ts
    lrclib/
      client.ts
      schema.ts
      mapper.ts
      rate-limiter.ts
  matching/
    score.ts
    version-conflicts.ts
    decision.ts
  lyrics/
    lrc-parser.ts
    validate.ts
  state/
    database.ts
    migrations.ts
    repository.ts
    retry-policy.ts
  filesystem/
    paths.ts
    atomic-writer.ts
    cleanup.ts
    lock.ts
  logging/
    events.ts
    human.ts
    jsonl.ts
  domain/
    types.ts
    errors.ts
```

This is guidance, not a required directory layout. The required separation is:

- discovery must not call providers;
- provider code must not write files;
- matcher must be pure and independently testable;
- writer must not perform network access;
- state policy must be testable without SQLite;
- CLI code must orchestrate rather than contain core logic.

---

## 13. Core domain types

Recommended result type:

```ts
type LookupResult =
  | {
      status: "found";
      provider: string;
      record: ProviderLyricsRecord;
      operation: "exact" | "search";
      score: number;
      reasons: MatchReason[];
    }
  | { status: "instrumental"; provider: string; recordId: number }
  | { status: "not_found"; provider: string }
  | {
      status: "ambiguous";
      provider: string;
      candidates: ScoredCandidate[];
    }
  | {
      status: "rate_limited";
      provider: string;
      retryAfterMs: number;
    }
  | {
      status: "temporary_error";
      provider: string;
      code: string;
      message: string;
    }
  | {
      status: "permanent_error";
      provider: string;
      code: string;
      message: string;
    }
  | {
      status: "invalid_response";
      provider: string;
      code: string;
      message: string;
    };
```

Recommended match decision:

```ts
type MatchDecision =
  | {
      decision: "accept";
      candidate: ScoredCandidate;
      score: number;
      reasons: MatchReason[];
    }
  | {
      decision: "reject";
      reasons: MatchReason[];
    }
  | {
      decision: "ambiguous";
      candidates: ScoredCandidate[];
      reasons: MatchReason[];
    };
```

Every rejection should include machine-readable reasons such as:

- `TITLE_MISMATCH`
- `ARTIST_MISMATCH`
- `DURATION_MISMATCH`
- `VERSION_CONFLICT`
- `SCORE_BELOW_THRESHOLD`
- `COMPETING_CANDIDATE`
- `MISSING_SYNCED_LYRICS`
- `INVALID_LRC`

---

## 14. Scan lifecycle

For each discovered track:

1. Canonicalize and verify path.
2. Read initial stat.
3. Check eligibility from durable state.
4. Check for an existing sidecar.
5. Parse metadata.
6. Build normalized identity and metadata hash.
7. Re-evaluate eligibility if metadata changed.
8. Perform exact lookup when possible.
9. Validate and verify exact result.
10. If needed, perform search fallback.
11. Score all candidates.
12. Select accept, ambiguous, instrumental, or not-found outcome.
13. Validate synchronized lyrics.
14. In dry-run mode, report without writing.
15. Re-read audio stat.
16. Atomically create sidecar without replacement.
17. Persist final state and attempt history.
18. Continue to the next track.
19. Emit final run summary.

Provider rate limiting applies across all tracks in a run.

---

## 15. Testing requirements

### 15.1 Unit tests

Required unit coverage areas:

- strict normalization;
- relaxed normalization;
- featured-artist handling;
- version-conflict detection;
- title, artist, album, and duration scoring;
- ambiguity handling;
- exact-result verification;
- LRCLIB JSON validation;
- `Retry-After` parsing;
- retry policy;
- LRC timestamp parsing;
- LRC validation;
- output path derivation;
- root containment;
- status serialization;
- configuration validation.

### 15.2 Fixture metadata tests

Include small legal test fixtures for:

- FLAC with Vorbis comments;
- MP3 with ID3v2.3;
- MP3 with ID3v2.4;
- M4A with iTunes-style metadata;
- Unicode artist and title;
- multiple artists;
- missing album;
- missing artist;
- malformed audio;
- duration edge cases.

Do not commit copyrighted full tracks. Use generated tones, public-domain samples, or deliberately minimal containers.

### 15.3 Provider integration tests

Use a local mock HTTP server to test:

- exact 200;
- exact 404 followed by search;
- instrumental;
- missing synchronized lyrics;
- malformed JSON;
- wrong content type;
- oversized body;
- timeout;
- connection reset;
- 429 with numeric `Retry-After`;
- 429 with HTTP-date `Retry-After`;
- 500 followed by success;
- repeated 500;
- forbidden redirect;
- 20 search candidates;
- ambiguous candidates.

Tests must not depend on the live LRCLIB service.

### 15.4 Filesystem tests

Test:

- existing `.lrc` is unchanged;
- sidecar creation;
- same-directory temporary file;
- no-replace race;
- process interruption before finalization;
- stale temporary cleanup;
- audio file changing during lookup;
- read-only directory;
- symlinked audio;
- symlinked output;
- output path escape attempts;
- hard-link finalization unsupported;
- Unicode filenames.

### 15.5 End-to-end acceptance test

Create a temporary library containing at least:

- one exact match;
- one search match;
- one instrumental;
- one not found;
- one ambiguous result;
- one existing sidecar;
- one invalid audio file;
- one file changed during processing.

Assert:

- expected state for every track;
- expected sidecars only;
- no changed audio checksums;
- no overwritten existing sidecar;
- no final partial files;
- correct exit code and summary;
- second run performs no ineligible repeat requests.

### 15.6 Coverage expectations

- matcher, validator, retry policy, and writer: at least 90% branch coverage;
- project overall: at least 80% branch coverage;
- safety-critical branches must be tested explicitly even if aggregate targets are met.

---

## 16. Operational deployment requirements

### 16.1 Service account

Recommended account:

- user: `lrc-sidecar`
- no interactive login;
- no sudo privileges;
- no access to Docker socket;
- read access to audio files;
- create access to album directories or the mounted music tree;
- exclusive write access to its state directory.

An existing unprivileged account may be selected when a network filesystem relies on that account's numeric UID. This is less isolated because the service receives the selected account's filesystem privileges; systemd hardening and write-path restrictions remain required.

### 16.2 Systemd

The application must work as a `Type=oneshot` service named `lrc-sidecar.service`, with recurring execution provided by `lrc-sidecar.timer`.

Recommended hardening where compatible:

- `NoNewPrivileges=true`
- `PrivateTmp=true`
- `ProtectSystem=strict`
- `ProtectHome=true`
- `ProtectKernelTunables=true`
- `ProtectKernelModules=true`
- `ProtectControlGroups=true`
- `RestrictSUIDSGID=true`
- `LockPersonality=true`
- `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6`

`MemoryDenyWriteExecute=true` is not compatible with the Node.js V8 runtime and must not be enabled.
- `ReadWritePaths=` limited to the state directory and music sidecar locations
- capability bounding set empty

The exact mount and NFS arrangement may require adjusting `ProtectSystem` and `ReadWritePaths`.

### 16.3 Scheduling

Default recommendation:

- run daily during a low-activity period;
- add randomized delay at the scheduler level;
- do not run more than one instance;
- initial backfill may be run manually.

### 16.4 Music-server separation

The music server must not share the writer identity.

Preferred model:

- LRC Sidecar: controlled write access for sidecar creation;
- Navidrome or another compatible music server: read-only music mount.

### 16.5 Installer

A self-contained shell installer should support local execution and execution from standard input so operators do not need to create systemd services manually. It must:

- require an explicit music root and render it into both the scan command and `ReadWritePaths`;
- create the default service account or validate a selected existing unprivileged account;
- create application directories idempotently and migrate state ownership when the selected identity changes;
- preserve existing configuration and state;
- validate the runtime as the service account before enabling the timer;
- never alter ownership or permissions in the music library;
- support pinned Git refs and optional source-archive checksum verification;
- preserve configuration and state during uninstall.

---

## 17. Performance expectations

Network throttling intentionally limits provider throughput. Correctness and service etiquette are more important than a fast initial backfill.

The implementation should:

- pipeline metadata parsing with a small bounded queue;
- retain provider concurrency of one;
- avoid parsing files that durable state marks ineligible;
- avoid reading embedded cover art;
- avoid buffering full audio files;
- provide visible progress for long scans.

No fixed tracks-per-second target is required for MVP.

---

## 18. Delivery milestones

### Milestone 1: Safe local scanner

- project skeleton;
- configuration;
- discovery;
- metadata extraction;
- normalization;
- state database;
- status command;
- no network or writes.

### Milestone 2: Exact LRCLIB lookup

- provider interface;
- HTTP bounds and response validation;
- throttling and retry behavior;
- exact matching;
- LRC validation;
- dry-run mode.

### Milestone 3: Safe sidecar writer

- file stability checks;
- atomic no-replace finalization;
- state transitions;
- crash and race tests;
- initial end-to-end workflow.

### Milestone 4: Search fallback

- candidate scoring;
- ambiguity detection;
- inspect command;
- real-world normalization fixtures.

### Milestone 5: Operational hardening

- doctor command;
- structured logs;
- systemd unit and timer examples;
- packaging;
- CI, coverage, dependency scanning;
- documentation.

---

## 19. MVP acceptance criteria

The MVP is ready for deployment only when all are true:

1. `lrc-sidecar scan` works against FLAC, MP3, and M4A fixtures.
2. Existing sidecars are never overwritten.
3. Audio files are never changed.
4. Synchronized lyrics are validated before writing.
5. Sidecar finalization is atomic and no-replace.
6. Exact and search results are locally verified.
7. Search acceptance requires the defined threshold and ambiguity margin.
8. Provider requests are sequential and delayed.
9. `Retry-After` is honored.
10. Timeouts, body limits, redirects, malformed JSON, and wrong types are handled.
11. State survives interruption and prevents unnecessary requests.
12. Temporary and permanent outcomes have separate retry policies.
13. `scan`, `inspect`, `status`, and `doctor` are implemented.
14. Human and JSON Lines output are available.
15. The complete automated test suite passes.
16. The end-to-end test proves unchanged audio checksums.
17. Deployment documentation uses an unprivileged service account.
18. There are no known high-severity dependency vulnerabilities.
19. The application can run successfully as a hardened systemd oneshot service on a supported Linux host.
20. The installer can deploy and validate the application without manual systemd unit creation.

---

## 20. Deferred enhancements

Potential post-MVP work:

- optional plain-lyrics sidecars;
- additional formats such as Ogg and Opus;
- additional providers;
- provider fallback order;
- manual candidate approval;
- explicit repair workflow for invalid sidecars;
- MusicBrainz-assisted identity normalization;
- filesystem event watching;
- Navidrome-triggered scan integration;
- Prometheus-compatible summary output;
- OCI image;
- signed release artifacts;
- SBOM generation;
- cross-platform safe writer support;
- local lyric correction workflow;
- LRCLIB database-dump support for offline matching.

---

## 21. Open implementation choices

The following choices may be resolved during implementation without changing product intent:

- exact internal queue implementation;
- test framework beyond required behavior;
- JSON Lines event field naming;
- lock-file mechanism;
- migration helper structure;
- token similarity implementation;
- whether systemd packaging is stored in the main repository;
- whether metadata parsing begins concurrently while prior provider requests are pending.

Any choice must preserve:

- provider concurrency of one;
- bounded resources;
- deterministic decisions;
- no-overwrite writes;
- explicit retry state;
- testable match reasoning.

---

## 22. Reference documentation

- LRCLIB API documentation: https://www.lrclib.net/docs
- `music-metadata` documentation: https://borewit.github.io/music-metadata/
- Node.js SQLite documentation: https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html

These external interfaces may evolve. Provider schemas, Node feature availability, and dependency versions must be verified and pinned during implementation.
