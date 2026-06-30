# Roadmap

proxsyno's MVP deliberately does one thing well: a DSM-style web app that manages
users, SMB/NFS shares, storage/SMART, and a jailed file browser on a Proxmox/Debian
host. The items below are **explicitly out of scope for the MVP** (see `SPEC.md`).
They are tracked here so contributors know what's wanted next and what is on purpose
left as a `TODO`.

## Out of scope for MVP

- [ ] **HTTPS / TLS** — the MVP serves plain HTTP on `:8800`. Terminate TLS with a
      reverse proxy (Caddy, nginx, or Traefik) in front of it. A documented
      reverse-proxy recipe is a good first contribution; native TLS may come later.
- [ ] **Two-factor auth (2FA)** — login is PAM + a session JWT cookie only. TOTP /
      WebAuthn enrollment is future work.
- [ ] **Quotas** — per-user / per-share disk quotas (XFS/ext4 project quotas or ZFS
      datasets) are not managed yet.
- [ ] **Snapshots UI** — no UI for ZFS/LVM snapshots, schedules, or rollback.
- [ ] **Docker / app store** — no container/app-catalog layer (the Synology
      "Package Center" analogue).
- [ ] **Multi-host** — single host only; no clustering, federation, or remote-host
      management.

## Likely near-term improvements

- [ ] Reverse-proxy quick-start (Caddy/nginx config + systemd notes).
- [ ] Storage **write** actions (currently read-only): create/format/mount volumes.
- [ ] Audit log of mutating actions (user/share changes).
- [ ] Rate-limiting / lockout on `POST /api/auth/login`.
- [ ] Run the service as a reduced-capability user where possible (today it must be
      root — see `docs/architecture.md` and `deploy/proxsyno.service`).

## Contributing

Contributions are welcome. A few ground rules to keep things consistent:

1. **`SPEC.md` is the contract.** Backend, frontend, and packaging all conform to
   it. If the spec is ambiguous, prefer the simplest secure option and leave a
   `// TODO(spec):` note rather than inventing new API shapes.
2. **Security rules are non-negotiable** (see `SPEC.md` §Security): never build
   shell strings from user input (`execFile`/`spawn` with arg arrays only); keep the
   file browser jailed to `FILES_ROOT`; validate every request body with `zod`.
3. **Two install paths exist** — the lightweight Cockpit installer (`install.sh`)
   and the custom app (`install-app.sh`). Keep both working; don't break one to add
   to the other.
4. Match the existing tone: short scripts, colored logs, idempotent installers,
   honest trade-off notes in the docs.

Open an issue describing the change before a large PR, and reference the roadmap
item it addresses.
