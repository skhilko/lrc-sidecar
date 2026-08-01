#!/usr/bin/env bash
set -Eeuo pipefail

readonly PROJECT="lrc-sidecar"
readonly REPOSITORY="skhilko/lrc-sidecar"
readonly INSTALL_DIR="/opt/lrc-sidecar"
readonly BIN_PATH="/usr/local/bin/lrc-sidecar"
readonly CONFIG_DIR="/etc/lrc-sidecar"
readonly CONFIG_PATH="${CONFIG_DIR}/config.json"
readonly STATE_DIR="/var/lib/lrc-sidecar"
readonly RUNTIME_DIR="/run/lrc-sidecar"
readonly SERVICE_PATH="/etc/systemd/system/lrc-sidecar.service"
readonly TIMER_PATH="/etc/systemd/system/lrc-sidecar.timer"
readonly DEFAULT_SERVICE_USER="lrc-sidecar"
readonly SYSTEM_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

MUSIC_ROOT=""
REF="main"
EXPECTED_SHA256=""
SOURCE_DIR=""
MUSIC_GROUP=""
SERVICE_USER="$DEFAULT_SERVICE_USER"
SERVICE_GROUP="$DEFAULT_SERVICE_USER"
SERVICE_USER_SET=false
ENABLE_TIMER=false
SKIP_DOCTOR=false
UNINSTALL=false
WORK_DIR=""
APP_STAGE=""

usage() {
  cat <<'EOF'
Install LRC Sidecar and its systemd service.

Usage:
  install.sh --music-root PATH [options]
  install.sh --uninstall

Options:
  --music-root PATH   Music library root (required for installation)
  --ref REF           Git branch, tag, or commit to install (default: main)
  --sha256 HASH       Expected SHA-256 of the downloaded source archive
  --source PATH       Install from a local source checkout instead of GitHub
  --service-user NAME Run as an existing unprivileged user (default: lrc-sidecar)
  --music-group NAME  Add the service account to an existing library group
  --enable            Enable and start the systemd timer after doctor passes
  --skip-doctor       Skip runtime validation (cannot be combined with --enable)
  --uninstall         Remove the application and units; keep config and state
  -h, --help          Show this help

The installer does not change ownership or permissions in the music library.
EOF
}

log() {
  printf '[%s] %s\n' "$PROJECT" "$*"
}

warn() {
  printf '[%s] WARNING: %s\n' "$PROJECT" "$*" >&2
}

die() {
  printf '[%s] ERROR: %s\n' "$PROJECT" "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$APP_STAGE" && -d "$APP_STAGE" ]]; then
    rm -rf -- "$APP_STAGE"
  fi
  if [[ -n "$WORK_DIR" && -d "$WORK_DIR" ]]; then
    rm -rf -- "$WORK_DIR"
  fi
}
trap cleanup EXIT

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

require_root() {
  [[ ${EUID:-$(id -u)} -eq 0 ]] || die "run this installer as root (for example, with sudo)"
}

parse_args() {
  while (($# > 0)); do
    case "$1" in
      --music-root)
        (($# >= 2)) || die "--music-root requires a path"
        MUSIC_ROOT=$2
        shift 2
        ;;
      --ref)
        (($# >= 2)) || die "--ref requires a value"
        REF=$2
        shift 2
        ;;
      --sha256)
        (($# >= 2)) || die "--sha256 requires a hash"
        EXPECTED_SHA256=${2,,}
        shift 2
        ;;
      --source)
        (($# >= 2)) || die "--source requires a path"
        SOURCE_DIR=$2
        shift 2
        ;;
      --service-user)
        (($# >= 2)) || die "--service-user requires a user name"
        SERVICE_USER=$2
        SERVICE_USER_SET=true
        shift 2
        ;;
      --music-group)
        (($# >= 2)) || die "--music-group requires a group name"
        MUSIC_GROUP=$2
        shift 2
        ;;
      --enable)
        ENABLE_TIMER=true
        shift
        ;;
      --skip-doctor)
        SKIP_DOCTOR=true
        shift
        ;;
      --uninstall)
        UNINSTALL=true
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "unknown option: $1"
        ;;
    esac
  done

  if [[ "$UNINSTALL" == true ]]; then
    [[ -z "$MUSIC_ROOT" && -z "$SOURCE_DIR" && -z "$EXPECTED_SHA256" && -z "$MUSIC_GROUP" && "$SERVICE_USER_SET" == false && "$ENABLE_TIMER" == false && "$SKIP_DOCTOR" == false ]] \
      || die "--uninstall cannot be combined with installation options"
    return
  fi

  [[ -n "$MUSIC_ROOT" ]] || die "--music-root is required"
  [[ "$SKIP_DOCTOR" == false || "$ENABLE_TIMER" == false ]] || die "--skip-doctor cannot be combined with --enable"
  [[ -z "$SOURCE_DIR" || -z "$EXPECTED_SHA256" ]] || die "--sha256 applies only to downloaded source"
  [[ "$SERVICE_USER" =~ ^[A-Za-z_][A-Za-z0-9_.-]*$ ]] || die "invalid --service-user value"
  [[ "$REF" =~ ^[A-Za-z0-9._/-]+$ && "$REF" != -* && "$REF" != *..* ]] || die "invalid --ref value"
  [[ -z "$EXPECTED_SHA256" || "$EXPECTED_SHA256" =~ ^[a-f0-9]{64}$ ]] || die "--sha256 must contain 64 hexadecimal characters"
}

find_system_node() {
  local node_path node_version major minor
  node_path=$(PATH="$SYSTEM_PATH" command -v node || true)
  [[ -n "$node_path" ]] || die "system-wide Node.js 24.12 or later was not found in $SYSTEM_PATH"
  node_version=$($node_path -p 'process.versions.node' 2>/dev/null) || die "could not run $node_path"
  IFS=. read -r major minor _ <<<"$node_version"
  [[ "$major" == 24 && "$minor" =~ ^[0-9]+$ && "$minor" -ge 12 ]] \
    || die "systemd requires system-wide Node.js >=24.12 <25; found $node_version at $node_path"
  printf '%s\n' "$node_path"
}

download() {
  local url=$1 destination=$2
  if command -v curl >/dev/null 2>&1; then
    curl --fail --location --proto '=https' --tlsv1.2 --silent --show-error "$url" --output "$destination"
  elif command -v wget >/dev/null 2>&1; then
    wget --https-only --quiet --output-document="$destination" "$url"
  else
    die "curl or wget is required to download source"
  fi
}

prepare_source() {
  local source_copy=$1 archive actual_sha
  if [[ -n "$SOURCE_DIR" ]]; then
    SOURCE_DIR=$(readlink -f -- "$SOURCE_DIR")
    [[ -f "$SOURCE_DIR/package.json" && -f "$SOURCE_DIR/package-lock.json" ]] || die "--source is not an LRC Sidecar checkout: $SOURCE_DIR"
    log "Copying local source from $SOURCE_DIR"
    tar --exclude=.git --exclude=node_modules --exclude=dist --exclude=coverage -C "$SOURCE_DIR" -cf - . | tar -C "$source_copy" -xf -
    return
  fi

  archive="$WORK_DIR/source.tar.gz"
  log "Downloading source ref $REF"
  download "https://codeload.github.com/${REPOSITORY}/tar.gz/${REF}" "$archive"
  actual_sha=$(sha256sum "$archive" | awk '{print $1}')
  if [[ -n "$EXPECTED_SHA256" && "$actual_sha" != "$EXPECTED_SHA256" ]]; then
    die "source archive checksum mismatch (expected $EXPECTED_SHA256, got $actual_sha)"
  fi
  log "Source archive SHA-256: $actual_sha"
  tar -xzf "$archive" --strip-components=1 -C "$source_copy"
}

resolve_service_account() {
  if [[ "$SERVICE_USER" == "$DEFAULT_SERVICE_USER" ]]; then
    if id "$SERVICE_USER" >/dev/null 2>&1 && [[ $(id -u "$SERVICE_USER") -eq 0 ]]; then
      die "service user cannot be root"
    fi
  else
    getent passwd "$SERVICE_USER" >/dev/null || die "service user does not exist: $SERVICE_USER"
    [[ $(id -u "$SERVICE_USER") -ne 0 ]] || die "service user cannot be root"
    SERVICE_GROUP=$(id -gn "$SERVICE_USER")
  fi
  if [[ -n "$MUSIC_GROUP" ]]; then
    getent group "$MUSIC_GROUP" >/dev/null || die "music group does not exist: $MUSIC_GROUP"
  fi
}

prepare_service_account() {
  if [[ "$SERVICE_USER" == "$DEFAULT_SERVICE_USER" ]]; then
    if ! getent group "$SERVICE_GROUP" >/dev/null; then
      groupadd --system "$SERVICE_GROUP"
    fi
    if ! id "$SERVICE_USER" >/dev/null 2>&1; then
      local nologin
      nologin=$(command -v nologin || printf '/usr/sbin/nologin')
      useradd --system --gid "$SERVICE_GROUP" --home-dir "$STATE_DIR" --shell "$nologin" "$SERVICE_USER"
    fi
  fi
  if [[ -n "$MUSIC_GROUP" ]]; then
    usermod --append --groups "$MUSIC_GROUP" "$SERVICE_USER"
  fi

  install -d -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 0750 "$STATE_DIR"
  install -d -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 0755 "$RUNTIME_DIR"
  # A reinstall may switch identities; existing database and lock files must remain usable.
  chown -R -- "$SERVICE_USER:$SERVICE_GROUP" "$STATE_DIR" "$RUNTIME_DIR"
  install -d -o root -g root -m 0755 "$CONFIG_DIR"
  log "Using service account $SERVICE_USER:$SERVICE_GROUP"
}

run_as_service() {
  # runuser preserves the caller's working directory, which may be inaccessible to the service account.
  (cd / && runuser -u "$SERVICE_USER" -- "$@")
}

install_application() {
  local source_copy=$1 node_path=$2 backup="${INSTALL_DIR}.backup.$$"
  local npm_path
  npm_path=$(PATH="$SYSTEM_PATH" command -v npm || true)
  [[ -n "$npm_path" ]] || die "system-wide npm was not found in $SYSTEM_PATH"

  if [[ ! -L "$BIN_PATH" && -e "$BIN_PATH" ]] && ! grep -q '^# Installed by lrc-sidecar installer$' "$BIN_PATH" 2>/dev/null; then
    die "$BIN_PATH already exists and is not managed by this installer"
  fi

  log "Building application"
  (
    cd "$source_copy"
    PATH="$SYSTEM_PATH" "$npm_path" ci --ignore-scripts
    PATH="$SYSTEM_PATH" "$npm_path" run build
  )

  APP_STAGE=$(mktemp -d "${INSTALL_DIR}.new.XXXXXX")
  install -m 0644 "$source_copy/package.json" "$source_copy/package-lock.json" "$APP_STAGE/"
  cp -a "$source_copy/dist" "$APP_STAGE/dist"
  (
    cd "$APP_STAGE"
    PATH="$SYSTEM_PATH" "$npm_path" ci --omit=dev --ignore-scripts
  )
  chown -R root:root "$APP_STAGE"
  chmod -R go-w "$APP_STAGE"

  rm -rf -- "$backup"
  if [[ -e "$INSTALL_DIR" ]]; then
    mv -- "$INSTALL_DIR" "$backup"
  fi
  if ! mv -- "$APP_STAGE" "$INSTALL_DIR"; then
    [[ ! -e "$backup" ]] || mv -- "$backup" "$INSTALL_DIR"
    die "could not activate application installation"
  fi
  APP_STAGE=""
  rm -rf -- "$backup"

  if [[ -L "$BIN_PATH" ]]; then
    rm -f -- "$BIN_PATH"
  fi
  cat >"$BIN_PATH" <<EOF
#!/bin/sh
# Installed by lrc-sidecar installer
exec "$node_path" "$INSTALL_DIR/dist/src/cli.js" "\$@"
EOF
  chmod 0755 "$BIN_PATH"
}

systemd_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/%/%%/g'
}

install_configuration() {
  local source_copy=$1
  if [[ -e "$CONFIG_PATH" ]]; then
    log "Preserving existing configuration at $CONFIG_PATH"
  else
    install -m 0644 "$source_copy/config.example.json" "$CONFIG_PATH"
    log "Installed default configuration at $CONFIG_PATH"
  fi
}

install_units() {
  local escaped_root
  escaped_root=$(systemd_escape "$MUSIC_ROOT")
  cat >"$SERVICE_PATH" <<EOF
[Unit]
Description=LRC Sidecar synchronized lyrics scan
Documentation=https://github.com/$REPOSITORY
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
User=$SERVICE_USER
Group=$SERVICE_GROUP
ExecStart=$BIN_PATH scan "$escaped_root" --config $CONFIG_PATH
StateDirectory=lrc-sidecar
RuntimeDirectory=lrc-sidecar
UMask=0022

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
MemoryDenyWriteExecute=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
CapabilityBoundingSet=
ReadWritePaths=$STATE_DIR $RUNTIME_DIR "$escaped_root"
EOF

  cat >"$TIMER_PATH" <<'EOF'
[Unit]
Description=Run LRC Sidecar daily

[Timer]
OnCalendar=*-*-* 03:30:00
RandomizedDelaySec=45m
Persistent=true
Unit=lrc-sidecar.service

[Install]
WantedBy=timers.target
EOF
  chmod 0644 "$SERVICE_PATH" "$TIMER_PATH"
  systemctl daemon-reload
}

check_music_access() {
  local probe writable_directory
  if ! run_as_service test -r "$MUSIC_ROOT" || ! run_as_service test -x "$MUSIC_ROOT"; then
    die "$SERVICE_USER cannot read/traverse $MUSIC_ROOT; grant access and rerun the installer"
  fi

  if ! probe=$(run_as_service find "$MUSIC_ROOT" -type f \( -iname '*.flac' -o -iname '*.mp3' -o -iname '*.m4a' \) -print -quit); then
    die "$SERVICE_USER cannot inspect $MUSIC_ROOT; grant access and rerun the installer"
  fi
  writable_directory=$MUSIC_ROOT
  if [[ -n "$probe" ]]; then
    writable_directory=$(dirname -- "$probe")
  fi
  if ! run_as_service test -w "$writable_directory" || ! run_as_service test -x "$writable_directory"; then
    die "$SERVICE_USER cannot create sidecars in $writable_directory; use --music-group or grant equivalent access, then rerun"
  fi
}

run_doctor() {
  log "Running doctor as $SERVICE_USER"
  run_as_service "$BIN_PATH" doctor "$MUSIC_ROOT" --config "$CONFIG_PATH"
}

uninstall_application() {
  require_root
  require_command systemctl
  log "Disabling systemd timer"
  systemctl disable --now lrc-sidecar.timer >/dev/null 2>&1 || true
  systemctl stop lrc-sidecar.service >/dev/null 2>&1 || true
  rm -f -- "$SERVICE_PATH" "$TIMER_PATH"
  if [[ -f "$BIN_PATH" ]] && grep -q '^# Installed by lrc-sidecar installer$' "$BIN_PATH"; then
    rm -f -- "$BIN_PATH"
  fi
  rm -rf -- "$INSTALL_DIR"
  systemctl daemon-reload
  log "Uninstalled application; preserved $CONFIG_DIR and $STATE_DIR"
}

main() {
  parse_args "$@"
  if [[ "$UNINSTALL" == true ]]; then
    uninstall_application
    return
  fi

  require_root
  for command in awk chown dirname find getent groupadd id install readlink runuser sed sha256sum systemctl tar useradd usermod; do
    require_command "$command"
  done
  [[ -d /run/systemd/system ]] || die "systemd is not running as the system service manager"

  [[ "$MUSIC_ROOT" != *$'\n'* && "$MUSIC_ROOT" != *$'\r'* ]] || die "music root cannot contain newline characters"
  MUSIC_ROOT=$(readlink -f -- "$MUSIC_ROOT")
  [[ -d "$MUSIC_ROOT" ]] || die "music root is not a directory: $MUSIC_ROOT"
  [[ "$MUSIC_ROOT" != / ]] || die "the filesystem root cannot be used as the music root"
  resolve_service_account

  local node_path source_copy
  node_path=$(find_system_node)
  WORK_DIR=$(mktemp -d)
  source_copy="$WORK_DIR/source"
  mkdir "$source_copy"
  prepare_source "$source_copy"
  [[ -f "$source_copy/config.example.json" && -f "$source_copy/src/cli.ts" ]] || die "downloaded source is incomplete"

  prepare_service_account
  install_application "$source_copy" "$node_path"
  install_configuration "$source_copy"
  install_units
  check_music_access

  if [[ "$SKIP_DOCTOR" == false ]]; then
    run_doctor || die "doctor failed; the timer was not enabled"
  else
    warn "runtime validation was skipped"
  fi

  if [[ "$ENABLE_TIMER" == true ]]; then
    systemctl enable --now lrc-sidecar.timer
    log "Installed and enabled lrc-sidecar.timer"
  else
    log "Installed successfully; enable scheduling with: systemctl enable --now lrc-sidecar.timer"
  fi
}

main "$@"
