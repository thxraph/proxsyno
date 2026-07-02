#!/usr/bin/env bash
#
# proxsyno (app) — install the custom full-stack NAS web app.
#
# This is the ALTERNATIVE to install.sh. Instead of Cockpit + 45Drives plugins,
# it deploys proxsyno's own Node/Express + React app as a systemd service that
# manages users, SMB/NFS shares, storage/SMART, and a jailed file browser from a
# single DSM-style UI on port 8800.
#
# It installs Node.js 20 + build deps, copies the repo to /opt/proxsyno, builds
# both halves (app/server -> dist, app/web -> dist), writes an env file with a
# generated JWT secret, then installs and enables the systemd unit.
#
# It does NOT touch your disks, RAID, filesystems, or running VMs/LXCs.
#
# Usage:
#   sudo ./install-app.sh [--files-root <path>] [--port <n>] [--admin-group <grp>] [--tls] [--yes]
#
# Flags:
#   --files-root <path>   Jail root for the file browser (default: /mnt).
#   --port <n>            Port the app listens on (default: 8800).
#   --admin-group <grp>   Unix group allowed to log in (default: sudo).
#   --tls                 Serve HTTPS with a self-signed cert (generated once);
#                         auto-enables the Secure session cookie. Sticky across
#                         re-installs. The app then listens on https://host:port.
#   --yes, -y             Non-interactive; assume "yes" to prompts.
#
# Re-running is safe (idempotent). An existing JWT secret is preserved.
#
set -euo pipefail

# ----------------------------------------------------------------------------
# defaults / config
# ----------------------------------------------------------------------------
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="/opt/proxsyno"
ENV_DIR="/etc/proxsyno"
ENV_FILE="${ENV_DIR}/proxsyno.env"
UNIT_SRC="${SRC_DIR}/deploy/proxsyno.service"
UNIT_DEST="/etc/systemd/system/proxsyno.service"
PAM_SRC="${SRC_DIR}/deploy/pam/proxsyno"
PAM_DEST="/etc/pam.d/proxsyno"
NODE_MAJOR=20

FILES_ROOT="/mnt"
PORT="8800"
ADMIN_GROUP="sudo"
ASSUME_YES=0
ENABLE_TLS=0

# ----------------------------------------------------------------------------
# helpers (style matches install.sh)
# ----------------------------------------------------------------------------
c_blue=$'\033[1;34m'; c_grn=$'\033[1;32m'; c_yel=$'\033[1;33m'; c_red=$'\033[1;31m'; c_rst=$'\033[0m'
log()  { printf '%s==>%s %s\n' "$c_blue" "$c_rst" "$*"; }
ok()   { printf '%s  ✓%s %s\n' "$c_grn"  "$c_rst" "$*"; }
warn() { printf '%s  !%s %s\n' "$c_yel"  "$c_rst" "$*" >&2; }
die()  { printf '%s  ✗%s %s\n' "$c_red"  "$c_rst" "$*" >&2; exit 1; }

usage() { sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

# ----------------------------------------------------------------------------
# arg parsing
# ----------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --files-root)  FILES_ROOT="${2:-}"; [[ -n "$FILES_ROOT" ]] || die "--files-root needs a path"; shift 2 ;;
    --port)        PORT="${2:-}"; [[ "$PORT" =~ ^[0-9]+$ ]] || die "--port needs a number"; shift 2 ;;
    --admin-group) ADMIN_GROUP="${2:-}"; [[ -n "$ADMIN_GROUP" ]] || die "--admin-group needs a group"; shift 2 ;;
    --tls)         ENABLE_TLS=1; shift ;;
    --yes|-y)      ASSUME_YES=1; shift ;;
    -h|--help)     usage 0 ;;
    *)             die "unknown argument: $1 (try --help)" ;;
  esac
done

# ----------------------------------------------------------------------------
# preflight
# ----------------------------------------------------------------------------
[[ $EUID -eq 0 ]] || die "run as root (sudo ./install-app.sh)"

command -v apt-get >/dev/null || die "this installer targets Debian/Proxmox (apt-get not found)"

[[ -f "$UNIT_SRC" ]] || die "missing $UNIT_SRC — run this from a full proxsyno checkout"
[[ -d "${SRC_DIR}/app/server" && -d "${SRC_DIR}/app/web" ]] || die "missing app/server or app/web — run from a full checkout"

. /etc/os-release 2>/dev/null || true
case "${ID:-}:${ID_LIKE:-}" in
  *debian*) : ;;
  *)        warn "non-Debian system (${ID:-unknown}); proceeding but untested" ;;
esac

if command -v pveversion >/dev/null 2>&1; then
  ok "Proxmox VE detected: $(pveversion | head -1)"
else
  warn "Proxmox not detected — proxsyno still works on plain Debian, just no VM host."
fi

if [[ $ASSUME_YES -ne 1 ]]; then
  echo
  echo "  This will:"
  echo "    • install Node.js ${NODE_MAJOR} + build deps (build-essential, libpam0g-dev, python3, git)"
  echo "    • copy this checkout to ${DEST} and build the app"
  echo "    • write ${ENV_FILE} (PORT=${PORT}, ADMIN_GROUP=${ADMIN_GROUP}, FILES_ROOT=${FILES_ROOT})"
  echo "    • install + enable the systemd service 'proxsyno' (runs as root)"
  echo
  read -r -p "  Continue? [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || die "aborted."
fi

export DEBIAN_FRONTEND=noninteractive

# ----------------------------------------------------------------------------
# 1. build dependencies
#    libpam0g-dev is required to compile the authenticate-pam native module.
# ----------------------------------------------------------------------------
log "Installing build dependencies…"
apt-get update -qq
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg \
  build-essential libpam0g-dev python3 git
ok "Build dependencies installed."

# ----------------------------------------------------------------------------
# 2. Node.js 20
#    Prefer NodeSource for a current Node 20; fall back to the distro package
#    if NodeSource setup fails or is unreachable.
# ----------------------------------------------------------------------------
install_node() {
  if command -v node >/dev/null 2>&1; then
    local have; have="$(node -v 2>/dev/null | sed 's/^v//; s/\..*//')"
    if [[ "${have:-0}" -ge "$NODE_MAJOR" ]]; then
      ok "Node.js $(node -v) already present — skipping."
      return 0
    fi
    warn "Node.js $(node -v) is older than v${NODE_MAJOR}; installing a newer one."
  fi

  log "Installing Node.js ${NODE_MAJOR} from NodeSource…"
  if curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" -o /tmp/nodesource_setup.sh \
     && bash /tmp/nodesource_setup.sh \
     && apt-get install -y nodejs; then
    rm -f /tmp/nodesource_setup.sh
    ok "Node.js $(node -v) installed (NodeSource)."
  else
    rm -f /tmp/nodesource_setup.sh
    warn "NodeSource setup failed; falling back to the distro nodejs + npm."
    apt-get install -y --no-install-recommends nodejs npm \
      || die "could not install Node.js — install Node ${NODE_MAJOR}+ manually and re-run."
    local have; have="$(node -v 2>/dev/null | sed 's/^v//; s/\..*//')"
    [[ "${have:-0}" -ge "$NODE_MAJOR" ]] \
      || die "distro Node.js is $(node -v), need >= v${NODE_MAJOR}. Use NodeSource or nvm."
    ok "Node.js $(node -v) installed (distro)."
  fi
}
install_node
command -v npm >/dev/null 2>&1 || die "npm not found after Node install."

# ----------------------------------------------------------------------------
# 3. copy repo to /opt/proxsyno (exclude node_modules and VCS noise)
# ----------------------------------------------------------------------------
log "Copying source to ${DEST}…"
mkdir -p "$DEST"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude '*.tmp' \
    --exclude 'tmp/' \
    "${SRC_DIR}/" "${DEST}/"
else
  warn "rsync not found; using cp (will not prune removed files)."
  cp -a "${SRC_DIR}/." "${DEST}/"
  rm -rf "${DEST}/.git"
  find "${DEST}" -type d -name node_modules -prune -exec rm -rf {} + 2>/dev/null || true
fi
ok "Source copied."

# ----------------------------------------------------------------------------
# 4. build both halves
# ----------------------------------------------------------------------------
build_half() {
  local dir="$1" name="$2"
  log "Building ${name} (${dir})…"
  ( cd "$dir" && { npm ci || npm install; } && npm run build ) \
    || die "build failed for ${name}"
  ok "${name} built."
}
build_half "${DEST}/app/server" "backend"
build_half "${DEST}/app/web"    "frontend"

[[ -f "${DEST}/app/server/dist/index.js" ]] \
  || die "backend build produced no dist/index.js — check app/server build output."

# ----------------------------------------------------------------------------
# 5. environment file (generate a strong JWT secret once, then preserve it)
# ----------------------------------------------------------------------------
log "Writing environment file ${ENV_FILE}…"
mkdir -p "$ENV_DIR"

JWT_SECRET=""
if [[ -f "$ENV_FILE" ]]; then
  JWT_SECRET="$(sed -n 's/^PROXSYNO_JWT_SECRET=//p' "$ENV_FILE" | head -1)"
fi
if [[ -z "$JWT_SECRET" || "$JWT_SECRET" == "CHANGE_ME_TO_A_LONG_RANDOM_STRING" ]]; then
  if command -v openssl >/dev/null 2>&1; then
    JWT_SECRET="$(openssl rand -hex 32)"
  else
    JWT_SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
  ok "Generated a new PROXSYNO_JWT_SECRET."
else
  ok "Preserving existing PROXSYNO_JWT_SECRET."
fi

# TLS: on if requested now (--tls) or already enabled on a previous install.
TLS_DIR="${ENV_DIR}/tls"
TLS_CERT="${TLS_DIR}/cert.pem"
TLS_KEY="${TLS_DIR}/key.pem"
EXISTING_TLS=""
[[ -f "$ENV_FILE" ]] && EXISTING_TLS="$(sed -n 's/^TLS_ENABLED=//p' "$ENV_FILE" | head -1)"
TLS_VALUE="false"
if [[ $ENABLE_TLS -eq 1 || "$EXISTING_TLS" == "true" ]]; then
  TLS_VALUE="true"
  mkdir -p "$TLS_DIR"; chmod 700 "$TLS_DIR"
  if [[ -f "$TLS_CERT" && -f "$TLS_KEY" ]]; then
    ok "Preserving existing TLS certificate (${TLS_CERT})."
  elif command -v openssl >/dev/null 2>&1; then
    fqdn="$(hostname -f 2>/dev/null || hostname)"
    if openssl req -x509 -newkey rsa:2048 -nodes -keyout "$TLS_KEY" -out "$TLS_CERT" \
         -days 3650 -subj "/CN=${fqdn}" \
         -addext "subjectAltName=DNS:${fqdn},DNS:localhost,IP:127.0.0.1" >/dev/null 2>&1; then
      chmod 600 "$TLS_KEY"
      ok "Generated self-signed TLS certificate (${TLS_CERT})."
    else
      warn "openssl failed to generate a certificate; leaving TLS disabled."
      TLS_VALUE="false"
    fi
  else
    warn "openssl not found; cannot generate a TLS certificate. Leaving TLS disabled."
    TLS_VALUE="false"
  fi
fi

umask 077
cat > "$ENV_FILE" <<EOF
# proxsyno app environment — generated by install-app.sh on $(date -u +%FT%TZ)
# Keep this file private: it holds the JWT signing secret. (mode 0600)
PROXSYNO_JWT_SECRET=${JWT_SECRET}
PORT=${PORT}
ADMIN_GROUP=${ADMIN_GROUP}
FILES_ROOT=${FILES_ROOT}
PAM_SERVICE=proxsyno
NODE_ENV=production
TLS_ENABLED=${TLS_VALUE}
EOF
chmod 600 "$ENV_FILE"
ok "Environment file written (mode 0600)."

# ----------------------------------------------------------------------------
# 5b. PAM profile (local-only auth; avoids winbind noise on Samba hosts)
# ----------------------------------------------------------------------------
log "Installing PAM profile ${PAM_DEST}…"
if [[ -f "$PAM_SRC" ]]; then
  install -m 0644 "$PAM_SRC" "$PAM_DEST"
  ok "PAM profile installed (auth service: proxsyno)."
else
  warn "missing $PAM_SRC; falling back to PAM_SERVICE=login in the env file."
  sed -i 's/^PAM_SERVICE=.*/PAM_SERVICE=login/' "$ENV_FILE"
fi

# ----------------------------------------------------------------------------
# 6. systemd unit
# ----------------------------------------------------------------------------
log "Installing systemd unit…"
install -m 0644 "$UNIT_SRC" "$UNIT_DEST"
systemctl daemon-reload
systemctl enable proxsyno.service >/dev/null 2>&1 || true
# Use restart (not `enable --now`): on a re-install of an already-running
# service, `--now` is a no-op and the new build would never load.
systemctl restart proxsyno.service
ok "Service 'proxsyno' enabled and (re)started."

sleep 1
if ! systemctl is-active --quiet proxsyno.service; then
  warn "Service is not active. Recent logs:"
  journalctl -u proxsyno.service -n 30 --no-pager >&2 || true
  die "proxsyno.service failed to start — see logs above."
fi

# ----------------------------------------------------------------------------
# done
# ----------------------------------------------------------------------------
ips="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]' | grep -v '^127' || true)"
echo
ok "proxsyno app install complete."
echo
scheme="http"; [[ "$TLS_VALUE" == "true" ]] && scheme="https"
echo "  Open proxsyno in your browser:"
for ip in $ips; do echo "      ${c_grn}${scheme}://${ip}:${PORT}${c_rst}"; done
[[ -z "$ips" ]] && echo "      ${scheme}://<this-host-ip>:${PORT}"
echo
if [[ "$TLS_VALUE" == "true" ]]; then
  warn "HTTPS uses a self-signed certificate — browsers will warn on first visit (expected)."
else
  warn "Serving plain HTTP. Re-run with --tls for built-in HTTPS, or use a TLS reverse proxy."
fi
echo
echo "  Login: a user in the '${ADMIN_GROUP}' group (NOT root — root cannot log in)."
echo "  No such user yet? Create one:"
echo "      sudo adduser nasadmin && sudo usermod -aG ${ADMIN_GROUP} nasadmin"
echo
echo "  File browser jail root : ${FILES_ROOT}"
echo "  Manage the service     : systemctl {status,restart,stop} proxsyno"
echo "  Tail logs              : journalctl -u proxsyno -f"
echo
