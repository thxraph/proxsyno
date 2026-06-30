#!/usr/bin/env bash
#
# proxsyno — turn a Proxmox-on-RAID box into a Synology-like NAS.
#
# Installs a web management layer (Cockpit + 45Drives plugins) and Samba on top
# of your EXISTING storage. It does not touch your disks, RAID, or filesystems —
# it only adds the management/sharing layer. Your VMs/LXCs keep running.
#
# Usage:
#   sudo ./install.sh [--with-nfs] [--admin <username>] [--yes]
#
# Flags:
#   --with-nfs        Also install/enable NFS server (nfs-kernel-server).
#   --admin <user>    Create a sudo-capable admin user for Cockpit login
#                     (Cockpit blocks root by default).
#   --yes             Non-interactive; assume "yes" to prompts.
#
# Re-running is safe (idempotent).
#
set -euo pipefail

# ----------------------------------------------------------------------------
# Pinned third-party packages (Cockpit plugins from 45Drives).
# These are arch-independent (_all.deb) web UIs. We download from the official
# 45Drives GitHub releases and verify SHA256 before installing — installing a
# .deb runs maintainer scripts as root, so verification is not optional.
# ----------------------------------------------------------------------------
GH_BASE="https://github.com/45Drives"

FS_NAME="cockpit-file-sharing"
FS_VER="4.6.0"
FS_DEB="cockpit-file-sharing_4.6.0-1bookworm_all.deb"
FS_URL="${GH_BASE}/cockpit-file-sharing/releases/download/v${FS_VER}/${FS_DEB}"
FS_SHA="26cdfe8ce2d80deea02f4d16014ba4f827282085fe7a14f9f73dfa63ca1a583b"

NAV_NAME="cockpit-navigator"
NAV_VER="0.6.1"
NAV_DEB="cockpit-navigator_0.6.1-1bookworm_all.deb"
NAV_URL="${GH_BASE}/cockpit-navigator/releases/download/v${NAV_VER}/${NAV_DEB}"
NAV_SHA="4512d21205ba248e4e693007d5d890253504ee82bcdfea58c05c084f39d7c1bf"

ID_NAME="cockpit-identities"
ID_VER="0.1.12"
ID_DEB="cockpit-identities_0.1.12-1focal_all.deb"
ID_URL="${GH_BASE}/cockpit-identities/releases/download/v${ID_VER}/${ID_DEB}"
ID_SHA="85d1412da210c86d0ebad35624fc512d895fd52f09ee0a8629cc1bc3bd0e825a"

# Base packages from the OS repos.
# NB: --no-install-recommends keeps cockpit-networkmanager OUT — on a Proxmox
# host the network is managed by ifupdown2 and we must not let anything else
# offer to "manage" vmbrX bridges.
BASE_PKGS=(cockpit-bridge cockpit-ws cockpit-system cockpit-storaged cockpit-packagekit samba)

WITH_NFS=0
ADMIN_USER=""
ASSUME_YES=0

# ----------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------
c_blue=$'\033[1;34m'; c_grn=$'\033[1;32m'; c_yel=$'\033[1;33m'; c_red=$'\033[1;31m'; c_rst=$'\033[0m'
log()  { printf '%s==>%s %s\n' "$c_blue" "$c_rst" "$*"; }
ok()   { printf '%s  ✓%s %s\n' "$c_grn"  "$c_rst" "$*"; }
warn() { printf '%s  !%s %s\n' "$c_yel"  "$c_rst" "$*" >&2; }
die()  { printf '%s  ✗%s %s\n' "$c_red"  "$c_rst" "$*" >&2; exit 1; }

usage() { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

# ----------------------------------------------------------------------------
# arg parsing
# ----------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-nfs) WITH_NFS=1; shift ;;
    --admin)    ADMIN_USER="${2:-}"; [[ -n "$ADMIN_USER" ]] || die "--admin needs a username"; shift 2 ;;
    --yes|-y)   ASSUME_YES=1; shift ;;
    -h|--help)  usage 0 ;;
    *)          die "unknown argument: $1 (try --help)" ;;
  esac
done

# ----------------------------------------------------------------------------
# preflight
# ----------------------------------------------------------------------------
[[ $EUID -eq 0 ]] || die "run as root (sudo ./install.sh)"

command -v apt-get >/dev/null || die "this installer targets Debian/Proxmox (apt-get not found)"

. /etc/os-release 2>/dev/null || true
case "${ID:-}:${ID_LIKE:-}" in
  *debian*) : ;;
  *)        warn "non-Debian system (${ID:-unknown}); proceeding but untested" ;;
esac

if [[ "${VERSION_CODENAME:-}" != "trixie" && "${VERSION_CODENAME:-}" != "bookworm" ]]; then
  warn "tested on Debian 12 (bookworm) / 13 (trixie); you have '${VERSION_CODENAME:-?}'"
fi

if command -v pveversion >/dev/null 2>&1; then
  ok "Proxmox VE detected: $(pveversion | head -1)"
else
  warn "Proxmox not detected — proxsyno still works on plain Debian, just no VM host."
fi

export DEBIAN_FRONTEND=noninteractive

# ----------------------------------------------------------------------------
# 1. base packages
# ----------------------------------------------------------------------------
log "Updating apt and installing base packages (Cockpit + Samba)…"
apt-get update -qq
apt-get install -y --no-install-recommends "${BASE_PKGS[@]}"
ok "Base packages installed."

if [[ $WITH_NFS -eq 1 ]]; then
  log "Installing NFS server…"
  apt-get install -y --no-install-recommends nfs-kernel-server
  systemctl enable --now nfs-server >/dev/null 2>&1 || true
  ok "NFS server installed and enabled."
fi

# ----------------------------------------------------------------------------
# 2. Cockpit plugins (verified third-party debs)
# ----------------------------------------------------------------------------
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fetch_verify_install() {
  local name="$1" ver="$2" url="$3" sha="$4" file="$TMP/${url##*/}"

  local cur
  cur="$(dpkg-query -W -f='${Version}' "$name" 2>/dev/null || true)"
  if [[ "$cur" == *"$ver"* ]]; then
    ok "$name $ver already installed — skipping."
    return 0
  fi

  log "Fetching $name $ver…"
  curl -fsSL -o "$file" "$url" || die "download failed: $url"

  log "Verifying SHA256 of $name…"
  echo "${sha}  ${file}" | sha256sum -c - >/dev/null 2>&1 \
    || die "CHECKSUM MISMATCH for $name — refusing to install. Expected $sha"
  ok "Checksum OK."

  apt-get install -y "$file"
  ok "$name $ver installed."
}

log "Installing Cockpit web plugins (file-sharing, navigator, identities)…"
fetch_verify_install "$FS_NAME"  "$FS_VER"  "$FS_URL"  "$FS_SHA"
fetch_verify_install "$NAV_NAME" "$NAV_VER" "$NAV_URL" "$NAV_SHA"
fetch_verify_install "$ID_NAME"  "$ID_VER"  "$ID_URL"  "$ID_SHA"

# ----------------------------------------------------------------------------
# 3. enable services
# ----------------------------------------------------------------------------
log "Enabling services…"
systemctl enable --now cockpit.socket >/dev/null
systemctl enable --now smbd nmbd      >/dev/null 2>&1 || systemctl enable --now smbd >/dev/null
ok "Cockpit and Samba enabled."

# ----------------------------------------------------------------------------
# 4. admin user (Cockpit refuses root login by default)
# ----------------------------------------------------------------------------
if [[ -n "$ADMIN_USER" ]]; then
  if id "$ADMIN_USER" >/dev/null 2>&1; then
    ok "User '$ADMIN_USER' already exists."
  else
    log "Creating admin user '$ADMIN_USER'…"
    adduser --gecos "" --disabled-password "$ADMIN_USER"
    warn "Set a login password now:"
    passwd "$ADMIN_USER"
  fi
  usermod -aG sudo "$ADMIN_USER"
  ok "'$ADMIN_USER' is a sudo-capable Cockpit admin."
fi

# ----------------------------------------------------------------------------
# done
# ----------------------------------------------------------------------------
ips="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]' | grep -v '^127' || true)"
echo
ok "proxsyno install complete."
echo
echo "  Open Cockpit in your browser (accept the self-signed cert):"
for ip in $ips; do echo "      ${c_grn}https://${ip}:9090${c_rst}"; done
[[ -z "$ips" ]] && echo "      https://<this-host-ip>:9090"
echo
echo "  Login: a regular sudo user (NOT root — Cockpit blocks root by default)."
if [[ -z "$ADMIN_USER" ]]; then
  echo "  No --admin user was created. Make one with:"
  echo "      sudo adduser nasadmin && sudo usermod -aG sudo nasadmin"
fi
echo
echo "  Next steps (in the Cockpit UI):"
echo "    • Identities  → create NAS user accounts + set their Samba passwords"
echo "    • File Sharing→ add an SMB${WITH_NFS:+/NFS} share pointing at your RAID mount"
echo "    • Navigator   → browse/upload files (File Station equivalent)"
echo "    • Storage     → watch your array, filesystems, SMART"
echo
echo "  See docs/post-install.md for the share-permissions walkthrough."
