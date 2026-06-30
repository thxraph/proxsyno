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

## Port map

| Port | Service     | Installed by |
| ---- | ----------- | ------------ |
| 8006 | Proxmox web | Proxmox      |
| 9090 | Cockpit     | proxsyno     |
| 445  | Samba (SMB) | proxsyno     |
| 2049 | NFS         | proxsyno (`--with-nfs`) |
