# proxsyno — backend (`app/server`)

Node.js 20 + Express + TypeScript (ESM) backend for proxsyno, a Synology-DSM-style
NAS manager that runs directly on a Proxmox/Debian host. It exposes a JSON API
under `/api` and a live-stats WebSocket at `/ws/system`, and in production serves
the built React frontend from `../web/dist`.

> This service must run as **root** (via systemd) because it calls `useradd`,
> `smbpasswd`, edits `/etc/samba/smb.conf`, reads SMART data, etc.

## Tech & security model

- **Auth:** PAM (`authenticate-pam`) → JWT in an **httpOnly, SameSite=Strict**
  cookie `proxsyno_session`. Only members of the configured admin group
  (`ADMIN_GROUP`, default `sudo`) may log in.
- **No shell strings.** Every OS call goes through `src/util/exec.ts`, which uses
  `execFile`/`spawn` with **argument arrays**. User input is never interpolated
  into a command string. Secrets (passwords) are passed on **stdin**, never argv.
- **Input validation.** Every request body/query is validated with `zod`.
  Usernames / group names / share names must match
  `^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,31}$`.
- **File browser is jailed** to `FILES_ROOT` (default `/mnt`). Each path is
  resolved and its `realpath` verified to stay inside the jail; `..` traversal
  and symlink escapes are rejected.
- All routes except `POST /api/auth/login` and `GET /api/health` require a valid
  session.

## Layout

```
src/
├── index.ts            # boot express + ws, mount routers, SPA serving
├── config.ts           # env parsing / single config object
├── auth/
│   ├── pam.ts          # authenticate-pam wrapper + group lookups
│   ├── jwt.ts          # sign/verify session JWTs
│   └── middleware.ts   # requireAuth / requireAdmin
├── routes/             # thin handlers, one router per domain
│   ├── auth.ts  system.ts  storage.ts  shares.ts  users.ts  files.ts
├── services/           # all system integration
│   ├── system.ts       # os/cpu/mem/uptime + WebSocket sampler
│   ├── storage.ts      # lsblk / mdstat+mdadm / zpool / smartctl
│   ├── samba.ts        # smb.conf managed blocks + /etc/exports
│   ├── identities.ts   # useradd/usermod/userdel/smbpasswd, list users/groups
│   └── fsbrowse.ts     # jailed file ops
└── util/
    ├── exec.ts         # execFile/spawn wrapper (NO shell interpolation)
    ├── errors.ts       # ApiError + JSON error middleware
    └── validate.ts     # shared zod helpers / NAME_REGEX
```

## API summary

Base path `/api`. Errors: `{ "error": { "code", "message" } }`.

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/auth/login` | `{username,password}` → sets cookie, `{user}` |
| POST | `/api/auth/logout` | clears cookie, `204` |
| GET  | `/api/auth/me` | current `{user}` or `401` |
| GET  | `/api/health` | `{status:"ok",version}` (public) |
| GET  | `/api/system` | host/cpu/mem/uptime/proxmox info |
| WS   | `/ws/system` | pushes `{tsMs,cpuPct,mem,net,load}` ~2s (cookie-authed) |
| GET  | `/api/storage/disks` | `lsblk -J -b -O` tree |
| GET  | `/api/storage/raid` | `/proc/mdstat` + `mdadm --detail` |
| GET  | `/api/storage/zfs` | `zpool list -Hp` (empty if no zfs) |
| GET  | `/api/storage/smart/:disk` | `smartctl -H -A` (degrades if missing) |
| GET  | `/api/shares` | `{smb:[...], nfs:[...]}` |
| POST/PUT/DELETE | `/api/shares/smb[/:name]` | managed smb.conf blocks + reload |
| POST | `/api/shares/nfs` | manage `/etc/exports` + `exportfs -ra` |
| DELETE | `/api/shares/nfs?path=...` | remove export |
| GET/POST | `/api/users` | list / create |
| PUT/DELETE | `/api/users/:name` | update / delete (`?deleteHome=bool`) |
| GET | `/api/groups` | list groups |
| GET | `/api/files/list?path=` | directory listing |
| GET | `/api/files/download?path=` | stream file |
| POST | `/api/files/upload?path=` | multipart field `file` |
| POST | `/api/files/mkdir` `{path}` | |
| POST | `/api/files/delete` `{path}` | recursive, jailed |
| POST | `/api/files/rename` `{from,to}` | |

## Configuration

Copy `.env.example` → `.env` (dev) or install as `/etc/proxsyno/proxsyno.env`
(prod). Key vars: `PROXSYNO_JWT_SECRET` (required, strong in prod), `PORT`
(8800), `ADMIN_GROUP` (sudo), `FILES_ROOT` (/mnt), `SESSION_TTL_SEC`,
`SMB_CONF`, `NFS_EXPORTS`, `NODE_ENV`.

## Dev / build / run

```bash
npm install        # needs build-essential + libpam0g-dev for authenticate-pam
npm run dev        # tsx watch src/index.ts
npm run build      # tsc -> dist/
npm start          # node dist/index.js
npm run typecheck  # tsc --noEmit
```

In dev, Vite (port 5173) proxies `/api` and `/ws` to `:8800`. In production,
set `NODE_ENV=production`; the server serves `../web/dist` at `/` with an SPA
fallback to `index.html` for non-`/api` routes.

## Notes / TODOs

- `// TODO(spec)`: HTTPS/TLS is out of scope — terminate TLS at a reverse proxy.
  The session cookie is marked `Secure` only when `NODE_ENV=production`.
- SMART/RAID/ZFS parsing is best-effort and degrades to empty/unknown when the
  underlying tool is absent. The full `smartctl` output is returned in `raw`.
- Samba reload uses `systemctl reload-or-restart smbd` then falls back to
  `smbcontrol smbd reload-config`.
