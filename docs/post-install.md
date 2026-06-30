# Post-install walkthrough

After `install.sh` finishes, open `https://<host-ip>:9090` and accept the
self-signed certificate.

## 1. Log in

Cockpit blocks `root` by default. Log in with a sudo user — either the one you
passed to `--admin`, or create one:

```bash
sudo adduser nasadmin
sudo usermod -aG sudo nasadmin
```

Tick **"Reuse my password for privileged tasks"** at login so you can make
admin changes.

## 2. Create NAS user accounts (→ Identities)

Open **Identities** → **Create new account**. For each person/device that will
access shares:

1. Create the account (this makes a Linux user).
2. Open the account → **Samba** → set a Samba password. SMB uses its own
   password database, so this step is required for share access.

> Tip: make a shared group for everyone who should reach the common files:
> `sudo groupadd nas` then add users with `sudo usermod -aG nas <user>`.

## 3. Create a shared folder + permissions (→ File Sharing)

Decide a layout on your existing array, e.g.:

```bash
sudo mkdir -p /mnt/raid/shares/media /mnt/raid/shares/backups
sudo chgrp -R nas /mnt/raid/shares
sudo chmod -R 2770 /mnt/raid/shares      # setgid: new files inherit the group
```

Then in **File Sharing** → **SMB** → **+**:

- **Share name**: `media`
- **Path**: `/mnt/raid/shares/media`
- Set **Valid users / groups** to `@nas` (the group) for access control.

Connect from clients:

- Windows: `\\<host-ip>\media`
- macOS: Finder → ⌘K → `smb://<host-ip>/media`
- Linux: `sudo mount -t cifs //<host-ip>/media /mnt/x -o user=<name>`

If you installed with `--with-nfs`, the **NFS** tab manages `/etc/exports` the
same way.

## 4. Browse files (→ Navigator)

**Navigator** is your File Station: browse `/mnt/raid`, upload/download, edit
permissions, create files/folders from the browser.

## 5. Watch the system (→ Overview / Storage)

- **Overview**: live CPU, memory, disk and network graphs.
- **Storage**: filesystems, usage, and SMART health for each drive. (RAID
  reshaping is still best done from the CLI / Proxmox — don't reshape a live
  array from a web UI.)

## Hardening (recommended)

- Restrict Cockpit to your management network with the host firewall (port 9090).
- Consider a real certificate: drop `fullchain.pem` + `key.pem` into
  `/etc/cockpit/ws-certs.d/` (alphabetically-last file wins).
- Keep the plugins updated by bumping the pinned versions in `install.sh` and
  re-running it.
