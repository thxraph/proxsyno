#!/usr/bin/env bash
#
# proxsyno uninstaller — removes the management layer (Cockpit + plugins + Samba).
# It does NOT delete your data, RAID, filesystems, users, or VMs/LXCs.
#
# Usage: sudo ./uninstall.sh [--purge] [--remove-samba]
#   --purge         also remove config files (apt purge)
#   --remove-samba  also remove the samba package (left installed by default,
#                   since other things may depend on it)
#
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }

PURGE=0; REMOVE_SAMBA=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge)        PURGE=1; shift ;;
    --remove-samba) REMOVE_SAMBA=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

export DEBIAN_FRONTEND=noninteractive
OP="remove"; [[ $PURGE -eq 1 ]] && OP="purge"

echo "==> Disabling Cockpit socket…"
systemctl disable --now cockpit.socket >/dev/null 2>&1 || true

PKGS=(cockpit-file-sharing cockpit-navigator cockpit-identities
      cockpit-storaged cockpit-packagekit cockpit-system cockpit-ws cockpit-bridge)
[[ $REMOVE_SAMBA -eq 1 ]] && PKGS+=(samba)

echo "==> apt-get $OP ${PKGS[*]}"
apt-get "$OP" -y "${PKGS[@]}" || true
apt-get autoremove -y || true

echo "✓ proxsyno management layer removed. Your storage, shares' data, and VMs are untouched."
[[ $REMOVE_SAMBA -eq 0 ]] && echo "  (samba left installed; re-run with --remove-samba to drop it)"
