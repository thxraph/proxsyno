# Architecture

proxsyno's whole philosophy: **add a management layer, change nothing underneath.**

## The layers

```
┌─────────────────────────────────────────────────────────────┐
│ Proxmox VE host (Debian)                                      │
│                                                               │
│  Storage (yours, untouched):                                  │
│    /mnt/raid   mdadm RAID5 / ZFS / LVM — bulk data            │
│    local-zfs   SSD pool — VM & LXC disks                      │
│                                                               │
│  Management planes:                                           │
│    :8006  Proxmox     → create/run VMs & LXCs   (native)      │
│    :9090  Cockpit     → NAS dashboard           (proxsyno)    │
│    :445   Samba       → SMB shares              (proxsyno)    │
│    :2049  NFS (opt)   → NFS exports             (proxsyno)    │
│                                                               │
│  Workloads on top:                                            │
│    VM 101  Home Assistant     LXC 200  app server   …         │
└─────────────────────────────────────────────────────────────┘
```

## Why on the host, not in a VM/LXC?

Your data sits on an array the **host kernel** owns (mdadm + ext4, or ZFS).
A NAS appliance in a VM (TrueNAS/OMV) wants to own raw disks via passthrough —
which means rebuilding your storage from scratch and migrating data. proxsyno
instead manages the array where it already lives. Cockpit + Samba run as ordinary
host services next to `pveproxy`; they share the same `/mnt/raid` the host mounts.

Trade-off: the NAS layer shares the host's fate and security boundary. For a home
/ homelab box that's the right call. If you need hard isolation, run OMV in a VM
with an HBA passed through instead — that's a deliberately different project.

## "VMs on top"

There is nothing special to install for this — it's just Proxmox doing what it
already does. proxsyno coexists:

- **VM/LXC disks** live on your SSD/ZFS pool (`local-zfs`), managed at `:8006`.
- **Bulk files** live on the RAID array, shared at `:9090` / `:445`.
- A VM that needs access to the bulk storage can mount the SMB/NFS share over the
  network, or — for an LXC — you can add a Proxmox **bind mount** of the host
  path (`pct set <id> -mp0 /mnt/raid/<folder>,mp=/data`).

## The custom app (alternative to Cockpit)

There are **two ways to run proxsyno** (see the README for which to pick):

- **(A) Cockpit installer** — `install.sh`, documented above. Reuses Cockpit +
  45Drives plugins; nothing custom runs.
- **(B) Custom full-stack app** — `install-app.sh`, described here. proxsyno's own
  DSM-style UI, one purpose-built service on `:8800`.

Same philosophy — *add a management layer, change nothing underneath* — just a
different management plane.

```
┌─────────────────────────────────────────────────────────────┐
│ Proxmox VE host (Debian)                                      │
│                                                               │
│  systemd: proxsyno.service  (runs as root)                    │
│    └─ node /opt/proxsyno/app/server/dist/index.js             │
│         :8800  Express API (/api) + WebSocket (/ws/system)    │
│                + serves the built React app (app/web/dist)    │
│                                                               │
│  It shells out (execFile, never shell strings) to:            │
│    useradd/usermod/passwd   → user accounts                   │
│    smbpasswd, smb.conf      → SMB shares (reload smbd)        │
│    /etc/exports, exportfs   → NFS exports                     │
│    lsblk/mdadm/zpool/smartctl → storage & SMART (read-only)   │
│    FILES_ROOT (default /mnt)  → jailed file browser           │
└─────────────────────────────────────────────────────────────┘
```

### Layout & build

Monorepo under `app/` (see `SPEC.md` for the full tree):

- `app/server` — Express + TypeScript (ESM). `npm run build` → `app/server/dist`.
- `app/web` — React + Vite + Tailwind. `npm run build` → `app/web/dist`.

In **production** the backend serves the built frontend from `app/web/dist` at `/`
and the API under `/api`, all on `:8800`. In **dev**, Vite runs on `:5173` and
proxies `/api` and `/ws` to `:8800`. Build both with `make build` (or
`install-app.sh`, which also deploys to `/opt/proxsyno` and installs the service).

### Why the service runs as root

The whole point of the app is to manage the host: create Unix users, set Samba
passwords, edit `/etc/samba/smb.conf` and `/etc/exports`, reload `smbd`, and read
SMART. Those operations need real root, so `deploy/proxsyno.service` sets
`User=root`. That also forces `NoNewPrivileges=false` and `RestrictSUIDSGID=false`
(it invokes setuid helpers like `passwd`/`smbpasswd`), and rules out
`ProtectSystem`/`ProtectHome` (it writes `/etc` and manages home dirs). The unit
keeps the hardening that *is* compatible (`ProtectKernelTunables`,
`ProtectControlGroups`).

**Trade-off:** like the Cockpit path, the NAS layer shares the host's fate and
security boundary. For a home / homelab box that's the right call. Reducing the
service's privileges is a tracked roadmap item. Until then, the service is plain
HTTP — put it behind a TLS reverse proxy before exposing it.

## Port map

| Port | Service          | Installed by |
| ---- | ---------------- | ------------ |
| 8006 | Proxmox web      | Proxmox      |
| 9090 | Cockpit          | proxsyno (`install.sh`) |
| 8800 | proxsyno app     | proxsyno (`install-app.sh`) |
| 445  | Samba (SMB)      | proxsyno     |
| 2049 | NFS              | proxsyno (`--with-nfs`) |

> Paths (A) and (B) both use port `8800`/`9090` respectively for their own UI but
> share the same underlying Samba/NFS. Pick one management UI; you don't need both.
