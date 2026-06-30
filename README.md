# proxsyno

**Turn a Proxmox-on-RAID server into a Synology-like NAS — without giving up your VMs.**

If you run [Proxmox VE](https://www.proxmox.com/) on a box with a RAID array, you
already have great virtualization and solid storage. What you *don't* get is the
friendly [Synology DSM](https://www.synology.com/en-us/dsm)-style experience:
shared folders, user accounts, a file browser, and a dashboard you can hand to a
non-sysadmin.

`proxsyno` adds exactly that layer — and nothing else. It installs
[Cockpit](https://cockpit-project.org/) plus the
[45Drives](https://github.com/45Drives) plugins and Samba **on top of your
existing storage**. It does not touch your disks, your RAID, your filesystems, or
your running VMs/LXCs.

```
  Proxmox host (hypervisor)
  ├── /mnt/raid  ← your existing array (untouched)
  ├── Cockpit  :9090   ← the "DSM" — shares, users, files, monitoring   ◀ proxsyno
  ├── Samba    :445    ← SMB/CIFS shares                                 ◀ proxsyno
  └── Proxmox  :8006   ← VMs & LXCs, exactly as before                   ◀ unchanged
```

## What you get

| Synology feature        | proxsyno equivalent                          |
| ----------------------- | -------------------------------------------- |
| Control Panel dashboard | Cockpit (`:9090`)                            |
| Shared Folders          | `cockpit-file-sharing` (SMB, optional NFS)   |
| Users & Permissions     | `cockpit-identities`                         |
| File Station            | `cockpit-navigator`                          |
| Storage Manager / SMART | `cockpit-storaged`                           |
| Virtual Machine Manager | Proxmox itself (you already have it)         |

## Requirements

- Proxmox VE 8/9 **or** plain Debian 12/13
- An existing mounted storage location (e.g. an mdadm/ZFS/LVM array at `/mnt/...`)
- Root access

## Quick start

```bash
git clone https://github.com/thxraph/proxsyno.git
cd proxsyno
sudo ./install.sh --admin nasadmin       # add --with-nfs to also enable NFS
```

Then open `https://<host-ip>:9090`, log in as your admin user, and create your
first share + users from the UI. See [`docs/post-install.md`](docs/post-install.md).

> **Why not `curl | bash`?** Because this installs third-party packages that run
> code as root. Clone it, read `install.sh` (it's short), then run it. The plugin
> downloads are pinned to specific versions and **SHA256-verified** before install.

## What it installs

- From the OS repos: `cockpit-{bridge,ws,system,storaged,packagekit}`, `samba`
  (and `nfs-kernel-server` with `--with-nfs`). Installed with
  `--no-install-recommends` so **`cockpit-networkmanager` is deliberately left
  out** — on a Proxmox host the network is owned by `ifupdown2` and nothing else
  should touch your `vmbrX` bridges.
- From [45Drives GitHub releases](https://github.com/45Drives), pinned + verified:
  `cockpit-file-sharing` 4.6.0, `cockpit-navigator` 0.6.1, `cockpit-identities` 0.1.12.

## Uninstall

```bash
sudo ./uninstall.sh        # removes the management layer; leaves data & VMs alone
```

## Notes & caveats

- Cockpit blocks **root** login by default. Use a regular sudo user (the
  `--admin` flag creates one for you).
- Cockpit listens on `0.0.0.0:9090`. If your host straddles multiple VLANs,
  restrict it with your firewall to your management network.
- This runs the NAS layer **directly on the Proxmox host**. That's intentional —
  it's the only way to manage a host-owned mdadm/ext4 array natively. If you'd
  rather isolate it, run OpenMediaVault in a VM with disk passthrough instead
  (different project, different trade-offs).

## License

MIT — see [LICENSE](LICENSE).
