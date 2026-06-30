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

## Two ways to run proxsyno

There are two installers — pick the one that fits you:

| | **(A) Cockpit installer** | **(B) Custom app** |
| --- | --- | --- |
| Script | `install.sh` | `install-app.sh` |
| UI | Cockpit + 45Drives plugins | proxsyno's own DSM-style web app |
| Port | `:9090` | `:8800` |
| What it is | proven, off-the-shelf, less to maintain | a single purpose-built UI for shares, users, storage & files |
| Maturity | stable | the project's own MVP (Node/Express + React) |

Both run **directly on the host** and share the same underlying Samba/NFS — you
only need one management UI. (A) is the safe default; (B) is the cohesive,
single-app experience this project is building toward.

## Requirements

- Proxmox VE 8/9 **or** plain Debian 12/13
- An existing mounted storage location (e.g. an mdadm/ZFS/LVM array at `/mnt/...`)
- Root access

## Quick start — (A) Cockpit installer

```bash
git clone https://github.com/thxraph/proxsyno.git
cd proxsyno
sudo ./install.sh --admin nasadmin       # add --with-nfs to also enable NFS
```

Then open `https://<host-ip>:9090`, log in as your admin user, and create your
first share + users from the UI. See [`docs/post-install.md`](docs/post-install.md).

## Quick start — (B) Custom app

The custom app is a Node/Express backend + React frontend, deployed as a single
systemd service on port `8800`.

**One-line install** (community-script style — run as root on the Proxmox host):

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/thxraph/proxsyno/main/bootstrap.sh)"
```

Pass `install-app.sh` flags after a `--`:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/thxraph/proxsyno/main/bootstrap.sh)" -- --files-root /mnt/raid
```

Or clone and run it yourself (read the script first — it runs as root):

```bash
git clone https://github.com/thxraph/proxsyno.git
cd proxsyno
sudo ./install-app.sh                     # add --files-root /mnt/raid --port 8800 etc.
```

Either way it installs Node.js 20 + build deps, copies the repo to `/opt/proxsyno`,
builds both halves, writes `/etc/proxsyno/proxsyno.env` (with a generated JWT
secret), and enables the `proxsyno` systemd service.

> Unlike most Proxmox community scripts, proxsyno installs **on the host**, not in
> a new LXC — it has to run on the host to manage the host's users, shares, and
> storage. It still touches none of your disks, RAID, or existing VMs/LXCs.

Then open `http://<host-ip>:8800` and log in.

### Logging in

You authenticate with **real Linux accounts** on the host (via PAM). Allowed:

- **`root`** — permitted by default (it's the natural NAS admin; disable with
  `ALLOW_ROOT_LOGIN=false`), or
- any user in the **`sudo`** group (configurable via `--admin-group`).

Other accounts are rejected with `403`. To make a dedicated admin user:

```bash
sudo adduser nasadmin && sudo usermod -aG sudo nasadmin   # then set its password
```

Useful flags: `--files-root <path>` (file-browser jail, default `/mnt`),
`--port <n>` (default `8800`), `--admin-group <grp>` (default `sudo`), `--yes`.

Manage it like any service: `systemctl status proxsyno`, `journalctl -u proxsyno -f`.

> **MVP serves plain HTTP.** The session cookie is therefore **not** marked
> `Secure` by default (a `Secure` cookie would be dropped by browsers over
> `http://` and login would silently fail). Put the app behind a **TLS reverse
> proxy** before exposing it beyond your LAN, and then set `COOKIE_SECURE=true`
> in `/etc/proxsyno/proxsyno.env` — see [`docs/roadmap.md`](docs/roadmap.md).

#### Login troubleshooting

- **Login seems to succeed then bounces back** → you're on HTTP with
  `COOKIE_SECURE=true`. Leave it `false` for plain HTTP.
- **`403` for a valid user** → that account isn't `root` and isn't in the
  `sudo` group. Add it: `sudo usermod -aG sudo <user>`.
- **`500 PAM module unavailable` / auth always fails** → the PAM profile is
  missing. `install-app.sh` installs `/etc/pam.d/proxsyno`; on a manual setup,
  create it (local-only `pam_unix`) or set `PAM_SERVICE=login`.

### Configuration (`/etc/proxsyno/proxsyno.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8800` | HTTP listen port |
| `ADMIN_GROUP` | `sudo` | group allowed to log in |
| `ALLOW_ROOT_LOGIN` | `true` | allow `root` to log in |
| `FILES_ROOT` | `/mnt` | file-browser jail root |
| `PAM_SERVICE` | `proxsyno` | PAM service used to verify passwords |
| `COOKIE_SECURE` | `false` | mark session cookie `Secure` (enable behind TLS) |
| `PROXSYNO_JWT_SECRET` | _generated_ | session-signing secret (keep private) |

### Developing the app

```bash
make install     # npm deps for app/server + app/web
make build       # build both (-> app/*/dist)
make dev         # prints how to run the two dev servers (backend :8800, Vite :5173)
```

See [`docs/architecture.md`](docs/architecture.md) for how the app is wired and
[`SPEC.md`](SPEC.md) for the API contract.

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
