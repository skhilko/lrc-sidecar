# LRC Sidecar

LRC Sidecar is a one-shot, self-hosted CLI that finds synchronized lyrics on LRCLIB and safely creates `.lrc` files beside FLAC, MP3, and M4A tracks.

It favors precision over coverage: provider results are validated and scored locally, close candidates remain ambiguous, and existing sidecars are never replaced.

## Requirements

- Linux
- Node.js 24.12 or later in the Node 24 release line
- An unprivileged account with read access to audio and create access in album directories
- HTTPS access to `https://lrclib.net`

## Install

```sh
npm ci --ignore-scripts
npm run build
npm link # optional; exposes the lrc-sidecar executable
```

Production execution uses compiled JavaScript (`node dist/src/cli.js`). The only runtime dependency is `music-metadata`.

## Commands

```sh
lrc-sidecar scan /srv/music \
  --state /var/lib/lrc-sidecar/state.sqlite \
  --lock /run/lrc-sidecar/scan.lock

lrc-sidecar scan /srv/music --dry-run --json
lrc-sidecar inspect /srv/music/Artist/Album/Track.flac
lrc-sidecar inspect /srv/music/Artist/Album/Track.flac --offline
lrc-sidecar status --state /var/lib/lrc-sidecar/state.sqlite
lrc-sidecar doctor /srv/music --state /var/lib/lrc-sidecar/state.sqlite
```

### Scan options

- `--state <path>` and `--lock <path>`
- `--config <path>`
- `--dry-run`, `--force-recheck`
- `--max-tracks <number>`
- `--metadata-concurrency <number>` (default 4)
- `--request-delay-ms <number>` (default 300)
- `--exact-timeout-ms <number>` and `--search-timeout-ms <number>`
- repeatable `--include <pattern>` and `--exclude <pattern>`
- `--score-threshold <number>`; values below 90 also require `--unsafe-score-threshold`
- `--json`, `--verbose`, `--quiet`
- `--unsafe-allow-root` deliberately bypasses the UID 0 refusal and prints a warning

JSON output is JSON Lines with stable event names. Routine output and durable state never contain lyric bodies.

## Configuration

Precedence is CLI, `LRC_SIDECAR_*` environment variables, JSON configuration, then built-in defaults. `/etc/lrc-sidecar/config.json` is loaded when it exists; use `--config` to select another file. Unknown JSON keys and unsafe values are rejected. See [`config.example.json`](config.example.json).

Supported environment variables:

- `LRC_SIDECAR_STATE`, `LRC_SIDECAR_LOCK`
- `LRC_SIDECAR_PROVIDER_ORIGIN`, `LRC_SIDECAR_USER_AGENT`
- `LRC_SIDECAR_SEARCH_FALLBACK`, `LRC_SIDECAR_STABILITY_AGE_MS`
- `LRC_SIDECAR_METADATA_CONCURRENCY`, `LRC_SIDECAR_REQUEST_DELAY_MS`
- `LRC_SIDECAR_EXACT_TIMEOUT_MS`, `LRC_SIDECAR_SEARCH_TIMEOUT_MS`
- `LRC_SIDECAR_SCORE_THRESHOLD`, `LRC_SIDECAR_AMBIGUITY_MARGIN`
- `LRC_SIDECAR_ALLOW_ROOT`

### Include/exclude matching

Patterns are matched against root-relative paths with `/` separators:

- a pattern without wildcards is a complete path or directory prefix (`Various` matches `Various/Album/a.mp3`);
- `*` matches characters within one path segment;
- `?` matches one character within one segment;
- `**` can cross directory separators.

Exclusions run before inclusions. Symlinks, non-regular files, unsupported extensions, and common temporary suffixes are always skipped.

## Safety model

- Audio is opened only for direct metadata reads. It is never tagged, renamed, moved, deleted, or written.
- Existing output paths—including symlinks—are preserved without provider lookup when state and input are unchanged.
- Every output path is derived only from the audio path and checked for music-root containment.
- Lyrics must contain valid timestamps and text, fit byte/duration bounds, and not resemble HTML or an error response.
- A same-directory temporary file is flushed, hard-linked to the final name (which fails if that name exists), and unlinked. There is no overwrite fallback.
- Audio size and modification time are checked before parsing and again before commit.
- SQLite state is committed per track. Retry dates distinguish negative, ambiguous, rate-limited, validation, and temporary outcomes.
- One lock file excludes concurrent write scans. Dead-PID lock files are recovered.
- Provider requests are globally sequential, delayed, bounded by time/body limits, redirect-free, and blocked through `Retry-After`.

The state database must be outside the music tree. Keep the music server on a separate read-only identity.

## Deployment

Example hardened units are in [`systemd/`](systemd/). Copy and adapt them:

```sh
sudo useradd --system --home /var/lib/lrc-sidecar --shell /usr/sbin/nologin lrc-sidecar
sudo install -d -o lrc-sidecar -g lrc-sidecar -m 0750 /var/lib/lrc-sidecar
sudo install -d -m 0755 /etc/lrc-sidecar
sudo install -m 0644 config.example.json /etc/lrc-sidecar/config.json
sudo install -m 0644 systemd/lrc-sidecar.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lrc-sidecar.timer
```

Change `/srv/music` and `ReadWritePaths` in the service. The timer runs daily with randomized delay. Run `doctor` under the service account before the first scan.

## Privacy

LRCLIB receives track title, artist, album when available, rounded duration for exact lookups, source IP, and the application User-Agent. LRC Sidecar does **not** upload audio, local paths, credentials, or its database. It has no telemetry.

## Development

```sh
npm run typecheck
npm test
npm run test:coverage
npm run audit
```

Tests use generated silence fixtures (including FLAC/Vorbis, ID3v2.3, ID3v2.4, and M4A metadata) and mock providers; they never call live LRCLIB. See [`lrc-sidecar-prd.md`](lrc-sidecar-prd.md) for the complete product contract.
