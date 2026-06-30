# proxsyno — build spec & API contract

This is the **single source of truth** every component is built against. Backend,
frontend, and packaging agents all conform to this file. If something here is
ambiguous, prefer the simplest secure option and leave a `// TODO(spec):` note.

## Goal

A self-hosted, Synology-DSM-style web app that manages a Linux/Proxmox host's
NAS functions: dashboard, storage/SMART, SMB + NFS shares, users & permissions,
and a file browser. Runs **directly on the host** alongside Proxmox. MVP first,
but real and runnable.

## Tech stack (decided)

- **Backend:** Node.js (>=20) + Express + **TypeScript**. ESM.
- **Frontend:** React + Vite + TypeScript + Tailwind CSS. Routing via
  `react-router`. Data fetching via `@tanstack/react-query`. Icons: `lucide-react`.
- **Auth:** PAM login (`authenticate-pam`) → JWT in an **httpOnly, SameSite=Strict**
  cookie. Only users in the `sudo` group (configurable) may log in.
- **Live stats:** WebSocket (`ws`) at `/ws/system`.
- **Process model:** backend runs as a **systemd service as root** (it must call
  `useradd`, `smbpasswd`, edit `/etc/samba/smb.conf`, read SMART). All routes
  except `/api/auth/login` and `/api/health` require a valid session.

## Monorepo layout

```
app/
├── server/                 # Express + TS backend
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example        # PROXSYNO_JWT_SECRET, PORT=8800, ADMIN_GROUP=sudo, ...
│   └── src/
│       ├── index.ts        # boot express + ws, mount routers
│       ├── config.ts       # env parsing
│       ├── auth/
│       │   ├── pam.ts      # authenticate-pam wrapper
│       │   ├── jwt.ts      # sign/verify
│       │   └── middleware.ts
│       ├── routes/         # one router per domain (see API below)
│       │   ├── auth.ts  system.ts  storage.ts  shares.ts  users.ts  files.ts
│       ├── services/       # the actual system integration (shell-outs)
│       │   ├── system.ts   # os/cpu/mem/uptime, /proc, websocket sampler
│       │   ├── storage.ts  # lsblk -J, /proc/mdstat, zpool, smartctl
│       │   ├── samba.ts    # parse/render smb.conf + /etc/exports
│       │   ├── identities.ts # useradd/usermod/smbpasswd, list users/groups
│       │   └── fsbrowse.ts # safe path-jailed file ops
│       └── util/
│           ├── exec.ts     # promisified execFile (NO shell string interpolation)
│           └── errors.ts   # ApiError -> JSON
└── web/                    # React frontend
    ├── package.json  vite.config.ts  tailwind.config.js  index.html
    └── src/
        ├── main.tsx  App.tsx  router.tsx
        ├── api/client.ts    # typed fetch wrapper, 401 -> /login
        ├── lib/types.ts     # shared response types (mirror this spec)
        ├── components/       # Sidebar, TopBar, StatCard, DataTable, Modal, ...
        └── pages/
            ├── Login.tsx  Dashboard.tsx  Storage.tsx
            ├── Shares.tsx  Users.tsx  Files.tsx
```

In production the backend serves the built frontend from `app/web/dist` at `/`,
and the API under `/api`. In dev, Vite proxies `/api` and `/ws` to `:8800`.

## Security rules (non-negotiable)

1. **Never** build shell command strings from user input. Use `execFile`/`spawn`
   with an args array (`util/exec.ts`). No `exec()` of interpolated strings.
2. File browser is **jailed** to a configured root (default `/mnt`); resolve and
   verify `realpath` stays inside the jail; reject `..` traversal and symlink escapes.
3. All mutating routes require auth middleware. JWT secret from env, never hardcoded.
4. Validate every request body with `zod`; reject unknown/oversized input.
5. Usernames/share names: enforce `^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,31}$`.

## API contract

Base path `/api`. All responses JSON. Errors: `{ "error": { "code": string, "message": string } }`
with appropriate HTTP status. Auth via cookie `proxsyno_session`.

### Auth
- `POST /api/auth/login` `{username, password}` → `200 {user:{name,groups,isAdmin}}` + sets cookie. `401` on bad creds, `403` if not in admin group.
- `POST /api/auth/logout` → `204`, clears cookie.
- `GET  /api/auth/me` → `200 {user}` or `401`.

### System / health
- `GET /api/health` → `{status:"ok",version}` (no auth).
- `GET /api/system` → `{hostname, os, kernel, uptimeSec, cpu:{model,cores,loadAvg:[1,5,15]}, mem:{totalKb,usedKb,freeKb}, isProxmox:boolean, pveVersion?:string}`.
- `WS  /ws/system` → pushes `{tsMs, cpuPct, mem:{usedKb,totalKb}, net:[{iface,rxBps,txBps}], load:[..]}` ~every 2s.

### Storage (read-only in MVP)
- `GET /api/storage/disks` → `[{name, sizeBytes, model?, type:"disk"|"part"|"raid"|"lvm"|"crypt", fstype?, mountpoint?, children?:[...]}]` (from `lsblk -J -b -O`).
- `GET /api/storage/raid` → `[{device, level, state, sizeBytes, active, total, syncPct?}]` (parse `/proc/mdstat` + `mdadm --detail`).
- `GET /api/storage/zfs` → `[{pool, sizeBytes, allocBytes, freeBytes, health, capPct}]` (`zpool list -Hp`); empty if no zfs.
- `GET /api/storage/smart/:disk` → `{device, healthy:boolean, temperatureC?, powerOnHours?, raw?:string}` (`smartctl -H -A`); degrade gracefully if smartctl missing.

### Shares
- `GET    /api/shares` → `{smb:[{name, path, comment?, readOnly, guestOk, validUsers:string[]}], nfs:[{path, clients:[{host, options}]}]}`.
- `POST   /api/shares/smb` `{name, path, comment?, readOnly?, guestOk?, validUsers?:string[]}` → `201 {share}`. Writes a managed block in `/etc/samba/smb.conf` and reloads smbd.
- `PUT    /api/shares/smb/:name` → update.
- `DELETE /api/shares/smb/:name` → `204`.
- `POST   /api/shares/nfs` `{path, clients:[{host, options?}]}` → manage `/etc/exports`, run `exportfs -ra`.
- `DELETE /api/shares/nfs?path=...` → `204`.

> Edit smb.conf **only inside delimited markers** so we never clobber hand-edits:
> `# >>> proxsyno managed: <name>` … `# <<< proxsyno managed: <name>`.
> Always validate with `testparm -s` before reloading; roll back on failure.

### Users (NAS accounts)
- `GET    /api/users` → `[{name, uid, groups:[string], hasSamba:boolean, shell, home}]` (human users uid>=1000, exclude `nobody`).
- `POST   /api/users` `{name, password, groups?:string[], sambaEnabled?:boolean}` → `201`. `useradd`, set unix pw, optional `smbpasswd -a`.
- `PUT    /api/users/:name` `{password?, groups?, sambaEnabled?}` → update.
- `DELETE /api/users/:name?deleteHome=bool` → `204`.
- `GET    /api/groups` → `[{name, gid, members:[string]}]`.

### Files (jailed browser, root configurable, default `/mnt`)
- `GET  /api/files/list?path=/mnt/raid` → `{path, entries:[{name, type:"file"|"dir"|"symlink", sizeBytes, mtimeMs, mode}]}`.
- `GET  /api/files/download?path=...` → streams file (`Content-Disposition`).
- `POST /api/files/upload?path=...` (multipart) → `201`.
- `POST /api/files/mkdir` `{path}` → `201`.
- `POST /api/files/delete` `{path}` → `204` (recursive for dirs, still inside jail).
- `POST /api/files/rename` `{from,to}` → `200`.

## Frontend UX

DSM-like but clean and modern (don't pixel-copy Synology — own look):
- **Login** page (centered card, product name "proxsyno").
- **App shell:** left sidebar (Dashboard, Storage, Shares, Users, Files) + top bar
  (hostname, logged-in user, logout). Responsive; collapsible sidebar on mobile.
- **Dashboard:** live CPU/mem/net cards (from `/ws/system`), uptime, OS/Proxmox
  badge, storage usage summary, quick links.
- **Storage:** disk tree table, RAID status (with sync progress bar), ZFS pools,
  SMART health badges.
- **Shares:** tabbed SMB / NFS; table + create/edit modal (zod-validated forms).
- **Users:** table; create/edit modal with group multiselect + "enable SMB" toggle.
- **Files:** breadcrumb + table; upload (drag-drop), download, mkdir, rename, delete.
- States: every page handles loading / empty / error. Use react-query.
- Theme: Tailwind, slate/zinc neutrals + one accent, light+dark, rounded-xl cards.

## Build, run, deploy

- `app/server`: `npm i && npm run dev` (tsx watch), `npm run build` (tsc → dist), `npm start`.
- `app/web`: `npm i && npm run dev` (Vite :5173, proxy to :8800), `npm run build` (→ dist).
- Root convenience: a `Makefile` or `npm` scripts to build both.
- `deploy/proxsyno.service`: systemd unit, runs `node app/server/dist/index.js` as
  root, `WorkingDirectory=/opt/proxsyno`, `Restart=on-failure`, env file
  `/etc/proxsyno/proxsyno.env`.
- `install.sh` (existing) gains a **`--app` mode** (or a second `install-app.sh`)
  that: installs Node 20 + build deps (`build-essential`, `libpam0g-dev` for
  authenticate-pam), copies repo to `/opt/proxsyno`, `npm ci && npm run build` both
  halves, writes the env file with a generated JWT secret, installs+enables the
  systemd unit. Keep the original Cockpit installer as an alternative path.

## Out of scope for MVP (leave TODOs)

HTTPS/TLS termination (document a reverse proxy), 2FA, quotas, snapshots UI,
Docker/app store, multi-host. Note these in docs/roadmap.
