#!/usr/bin/env bash
#
# proxsyno — community one-line bootstrap installer.
#
# Run on a Proxmox VE host (or plain Debian) as root:
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/thxraph/proxsyno/main/bootstrap.sh)"
#
# Pass install-app.sh flags after a `--`:
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/thxraph/proxsyno/main/bootstrap.sh)" -- --files-root /mnt/raid --port 8800
#
# What it does: installs git, clones proxsyno to /opt/proxsyno-src, and runs
# install-app.sh (which builds the app and installs the systemd service on :8800).
#
# Unlike most Proxmox community scripts, proxsyno installs ON THE HOST rather than
# in a new LXC — it has to run on the host to manage the host's users, shares and
# storage. It does NOT touch your disks, RAID, filesystems, or existing VMs/LXCs.
#
set -euo pipefail

REPO_URL="${PROXSYNO_REPO:-https://github.com/thxraph/proxsyno.git}"
BRANCH="${PROXSYNO_BRANCH:-main}"
SRC="${PROXSYNO_SRC:-/opt/proxsyno-src}"

c_blue=$'\033[1;34m'; c_grn=$'\033[1;32m'; c_yel=$'\033[1;33m'; c_red=$'\033[1;31m'; c_rst=$'\033[0m'
log()  { printf '%s==>%s %s\n' "$c_blue" "$c_rst" "$*"; }
ok()   { printf '%s  ✓%s %s\n' "$c_grn"  "$c_rst" "$*"; }
warn() { printf '%s  !%s %s\n' "$c_yel"  "$c_rst" "$*" >&2; }
die()  { printf '%s  ✗%s %s\n' "$c_red"  "$c_rst" "$*" >&2; exit 1; }

cat <<'BANNER'

   ___  ____ ___ _  _ ____ _  _ _  _ ____
   |__] |__/ |  |  \/  [__   \_/ |\ | |  |
   |    |  \ |__| _/\_ ___]  | | | \| |__|

   Proxmox-on-RAID  ->  Synology-like NAS
BANNER

[[ $EUID -eq 0 ]] || die "run as root:  bash -c \"\$(curl -fsSL .../bootstrap.sh)\""
command -v apt-get >/dev/null || die "this targets Debian/Proxmox (apt-get not found)"

if command -v pveversion >/dev/null 2>&1; then
  ok "Proxmox VE detected: $(pveversion | head -1)"
else
  warn "Proxmox not detected — proxsyno still installs on plain Debian."
fi

log "Ensuring git + curl are installed…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends git curl ca-certificates >/dev/null
ok "Prerequisites ready."

if [[ -d "$SRC/.git" ]]; then
  log "Updating existing checkout at ${SRC}…"
  git -C "$SRC" fetch --depth=1 origin "$BRANCH"
  git -C "$SRC" reset --hard "origin/${BRANCH}"
else
  log "Cloning proxsyno into ${SRC}…"
  rm -rf "$SRC"
  git clone --depth=1 -b "$BRANCH" "$REPO_URL" "$SRC"
fi
ok "Source ready at ${SRC}."

[[ -f "$SRC/install-app.sh" ]] || die "install-app.sh missing from the checkout — wrong branch/repo?"
chmod +x "$SRC/install-app.sh"

log "Handing off to install-app.sh…"
echo
# Pass through any flags given after `--`; default to non-interactive.
exec "$SRC/install-app.sh" --yes "$@"
