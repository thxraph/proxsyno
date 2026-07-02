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
- `POST /api/auth/login` `{username, password}` → `200 {user:{name,groups,isAdmin}}` + sets cookie. `401` on bad creds (generic message — never reveals whether the user exists), `403` if authenticated but not in admin group, `429` when rate-limited.
- `POST /api/auth/logout` → `204`, clears cookie.
- `GET  /api/auth/me` → `200 {user}` or `401`.

**Hardening (all enforced server-side):**
- **JWT**: HS256 pinned (no `none`/alg-downgrade), issuer checked, payload shape validated. Secret from env, **≥32 chars required in production**.
- **Cookie**: httpOnly + SameSite=Strict + Path=/; `Secure` when `COOKIE_SECURE=true`, and then named with the **`__Host-`** prefix (host-pinned).
- **Brute-force guard**: login locks out after 5 failures (per client IP *and* per username) for 15 min → `429` + `Retry-After`. In-memory; a valid login resets the counters.
- **CSRF**: SameSite=Strict cookie + an Origin/Referer check that rejects cross-origin state-changing requests (`POST/PUT/PATCH/DELETE`) and cross-origin WebSocket upgrades. Absent Origin (non-browser clients) is allowed.
- **Security headers** on every response: `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'` (clickjacking), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` (camera/mic/geo off), and HSTS once `COOKIE_SECURE` is on.
- **Username** validated to a Unix-name charset (blocks option-injection into `id`/`getent`).
- Known trade-off: JWTs are stateless, so logout clears the cookie but a *stolen* token stays valid until expiry (default 12h). httpOnly + SameSite=Strict prevent theft; lower `SESSION_TTL_SEC` to shrink the window. **Enable TLS** for the full guarantee (Secure cookie + `__Host-` + HSTS): either `TLS_ENABLED=true` with a cert/key (`install-app.sh --tls` generates a self-signed pair and listens HTTPS on `PORT`; `HTTP_REDIRECT_PORT` optionally 301s old http:// links), or terminate TLS at a reverse proxy and set `COOKIE_SECURE=true`. `COOKIE_SECURE` auto-enables when `TLS_ENABLED` is on.

### System / health
- `GET /api/health` → `{status:"ok",version}` (no auth).
- `GET /api/system` → `{hostname, os, kernel, uptimeSec, cpu:{model,cores,loadAvg:[1,5,15]}, mem:{totalKb,usedKb,freeKb}, isProxmox:boolean, pveVersion?:string}`.
- `WS  /ws/system` → pushes `{tsMs, cpuPct, mem:{usedKb,totalKb}, net:[{iface,rxBps,txBps}], load:[..]}` ~every 2s.

### Storage (read-only in MVP)
- `GET /api/storage/disks` → `[{name, sizeBytes, model?, type:"disk"|"part"|"raid"|"lvm"|"crypt", fstype?, mountpoint?, children?:[...]}]` (from `lsblk -J -b -O`).
- `GET /api/storage/raid` → `[{device, level, state, sizeBytes, active, total, syncPct?}]` (parse `/proc/mdstat` + `mdadm --detail`).
- `GET /api/storage/zfs` → `[{pool, sizeBytes, allocBytes, freeBytes, health, capPct}]` (`zpool list -Hp`); empty if no zfs.
- `GET /api/storage/smart/:disk` → `{device, healthy:boolean, temperatureC?, powerOnHours?, raw?:string}` (`smartctl -H -A`); degrade gracefully if smartctl missing.
- `GET  /api/storage/scrub` → `[{array, syncAction, progressPct?, mismatchCnt, schedule:{frequency:"disabled"|"weekly"|"monthly", weekday, day, hour, minute}, lastRunMs?, nextRunMs?}]` — per md array: live scrub state from `/sys/block/<md>/md/{sync_action,sync_completed,mismatch_cnt}`, plus the managed schedule and systemd timer's last/next run.
- `PUT  /api/storage/scrub/:array` body `{frequency, weekday:0-6, day:1-28, hour:0-23, minute:0-59}` → writes the schedule to `/etc/proxsyno/scrub.json` and installs/removes a per-array systemd timer (`proxsyno-scrub@<md>.timer`) running `checkarray`. Returns the updated status. `:array` validated `^md\d+$` and against real arrays.
- `POST /api/storage/scrub/:array/start` → begins a scrub now (writes `check` to the array's `sync_action`). 409 if the array is already syncing. → 204.
- `POST /api/storage/scrub/:array/cancel` → aborts a running scrub (writes `idle`). → 204.
- `GET  /api/storage/selftest` → `[{disk, running?:{remainingPct}, lastResult?:{num,description,status,passed,lifetimeHours?}, history:[...], schedule:{frequency:"disabled"|"weekly"|"monthly", type:"short"|"long", weekday, day, hour, minute}, lastRunMs?, nextRunMs?}]` — per physical disk: SMART self-test log + execution status via `smartctl -c -l selftest`, the managed schedule, and the systemd timer's last/next run.
- `PUT  /api/storage/selftest/:disk` body `{frequency, type:"short"|"long", weekday:0-6, day:1-28, hour:0-23, minute:0-59}` → writes the schedule to `/etc/proxsyno/selftests.json` and installs/removes a per-disk systemd timer (`proxsyno-selftest-<disk>.timer`) running `smartctl -t <type>`. Returns the updated status. `:disk` validated and checked against real block devices.
- `POST /api/storage/selftest/:disk/start` body `{type:"short"|"long"}` → begins a self-test now (`smartctl -t`). 409 if one is already running. → 204.
- `POST /api/storage/selftest/:disk/cancel` → aborts a running self-test (`smartctl -X`). → 204.

### Notifications
- `GET  /api/notifications` → `{items:[{id, ts, severity:"info"|"warning"|"critical", source, title, message}], unreadCount}` — newest-first event log (ring, last 200) from the health evaluator.
- `POST /api/notifications/read` → `204`, marks all as read (advances the read marker).
- `GET  /api/notifications/settings` → `{minSeverity:"info"|"warning"|"critical", thresholds:{diskPct, tempC}, sinks:{ntfy:{enabled,url,topic}, webhook:{enabled,url}, telegram:{enabled,botToken,chatId}}}`.
- `PUT  /api/notifications/settings` (same shape) → saves to `/etc/proxsyno/notifications.json`.
- `POST /api/notifications/test` → `{results:[{sink, ok, error?}]}`, sends a test to every enabled sink.

A server-side evaluator runs every `NOTIFY_INTERVAL_SEC` (default 300s) and edge-triggers alerts on: RAID degraded, scrub mismatches, SMART self-test failure / health-not-PASSED / over-temperature, filesystem or ZFS pool usage over threshold, ZFS pool not ONLINE. Each condition fires ONCE when it appears and logs a resolution when it clears; events at/above `minSeverity` are dispatched to the configured sinks (ntfy / webhook / Telegram, all HTTP POST). SSRF note: sink URLs are admin-configured by design.

### Shares
- `GET    /api/shares` → `{smb:[{name, path, comment?, readOnly, guestOk, validUsers:string[], managed:boolean}], nfs:[{path, clients:[{host, options}]}]}`. Lists ALL smb.conf share sections (minus Samba's special `global`/`homes`/`printers`/`print$`); `managed:false` marks hand-authored shares outside proxsyno's markers (surfaced read-only — the UI hides edit/delete). `POST`/`PUT` refuse to shadow an unmanaged section of the same name (409).
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
  SMART health badges, per-array RAID scrub scheduling (frequency/time), run-now
  and cancel, with live check progress and mismatch count; per-disk SMART
  self-test scheduling (short/long) with run-now, cancel, and pass/fail history;
  failed tests surfaced on the Dashboard.
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

---

# Addendum: Virtualization (Proxmox) — VMs, LXC, community scripts

Adds a **Virtualization** page that lists VMs + LXC guests, controls their
lifecycle, creates new ones (manual VM via `qm`, manual LXC via `pct`), and runs
**community-scripts** (community-scripts/ProxmoxVE) inside an interactive
in-browser terminal. All routes require auth; all shell-outs use the execFile
args-array wrapper (no shell strings). If `qm`/`pct` are absent (non-Proxmox host)
the API returns `{isProxmox:false}` and the UI hides the menu.

## Backend (app/server)

New `services/proxmox.ts` (wraps `pvesh`/`qm`/`pct`/`pvesm`/`pveam`) and
`routes/proxmox.ts`. Add a PTY console WebSocket. New deps: `node-pty`
(native; build deps already installed by install-app.sh).

### Types
- Guest: `{ vmid:number, type:"qemu"|"lxc", name:string, status:"running"|"stopped"|"paused"|"unknown", node:string, cpu:number /*0..1*/, maxcpu:number, mem:number, maxmem:number, disk:number, maxdisk:number, uptimeSec:number, template:boolean }`
- ScriptMeta: `{ slug:string, name:string, description?:string, category?:string, source:string /* "ct/<slug>.sh" */, url:string }`

### REST (base `/api/proxmox`)
- `GET  /available` → `{ isProxmox:boolean, node:string, pveVersion?:string }`
- `GET  /guests` → `Guest[]`  (from `pvesh get /cluster/resources --type vm --output-format json`)
- `POST /guests/:type/:vmid/:action` — `type∈{qemu,lxc}`, `action∈{start,stop,shutdown,reboot}` → `202 {ok:true}` (`qm <action> <vmid>` / `pct <action> <vmid>`). Validate vmid is int, enums strict.
- `GET  /options` → form data: `{ node, nextId:number, storages:[{name,type,content:string[],availBytes,totalBytes}], isos:[{volid,storage,sizeBytes}], templates:[{volid,storage,name}], bridges:[{name}], osTypes:string[] }`
  (`pvesh get /cluster/nextid`; `pvesm status`; `pvesm list <storage> --content iso`; `pveam available`+`pveam list <storage>`; bridges from `ip -j link` where name matches `^vmbr\d+`)
- `POST /vm` body `{ name, cores, memoryMB, diskGB, storage, isoVolid?, bridge, ostype? }` →
  `qm create <nextid> --name … --cores … --memory … --net0 virtio,bridge=<bridge> --scsihw virtio-scsi-pci --scsi0 <storage>:<diskGB> [--ide2 <isoVolid>,media=cdrom] [--ostype …] --boot order=scsi0;ide2` → `201 {vmid}`
- `POST /lxc` body `{ hostname, templateVolid, cores, memoryMB, diskGB, storage, bridge, password, unprivileged?=true, startOnCreate?=false }` →
  `pct create <nextid> <templateVolid> --hostname … --cores … --memory … --rootfs <storage>:<diskGB> --net0 name=eth0,bridge=<bridge>,ip=dhcp --password <pw> [--unprivileged 1]`, then optional `pct start`. → `201 {vmid}`.
  (NOTE the password is on argv — visible only to root via /proc; acceptable for MVP, leave a `// TODO(security)` to switch to a no-leak method.)
- `GET  /scripts` → `ScriptMeta[]` — catalog of community scripts. Build from the
  official repo metadata; **cache** in memory (TTL ~6h). Robust source discovery:
  try the repo's JSON metadata; fall back to deriving slug+name from the `ct/*.sh`
  filenames listed via the GitHub trees API. Pin owner/repo/branch to constants
  (`community-scripts/ProxmoxVE`, `main`). NEVER accept a user-supplied URL.

### Console WebSocket — `/ws/proxmox/console?script=<slug>`
- Authenticate the session cookie during the HTTP `upgrade` (same pattern as `/ws/system`); reject `401` otherwise.
- Validate `slug` matches `^[a-z0-9][a-z0-9-]{0,63}$` AND exists in the cached catalog. Reject otherwise.
- Spawn a PTY: `node-pty.spawn("bash", ["-lc", "$(curl -fsSL https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/ct/<slug>.sh)"], { name:"xterm-color", cols, rows, env })` — URL built ONLY from pinned constants + validated slug.
- **Wire protocol (JSON text frames both directions):**
  - C→S `{ "type":"input", "data":string }` — keystrokes → `pty.write`
  - C→S `{ "type":"resize", "cols":number, "rows":number }` → `pty.resize`
  - S→C `{ "type":"output", "data":string }` — pty data
  - S→C `{ "type":"exit", "code":number }` — process ended; then close
  - S→C `{ "type":"error", "message":string }`
- Kill the PTY if the socket closes.

## Frontend (app/web)
- Add **Virtualization** to the sidebar (hide if `GET /available` → `isProxmox:false`).
- **Guests table:** name, type badge (VM/LXC), vmid, status badge, cpu%/mem bars, uptime; row actions Start/Stop/Reboot/Shutdown (confirm on stop/reboot) → `POST /guests/...`, then refetch (react-query invalidate).
- **+ Create** opens a wizard/modal with three tabs:
  - *Virtual Machine* — name, cores, RAM (MB), disk (GB), storage (select from `/options`), ISO (select), bridge (select), ostype. → `POST /vm`.
  - *LXC Container* — hostname, template (select), cores, RAM, disk, storage, bridge, root password, unprivileged toggle, start-after-create toggle. → `POST /lxc`.
  - *Community Script* — searchable list from `/scripts` (name + description + category); on select show a **confirm panel** with the source URL and a "⚠ runs as root on the host" warning; on confirm open a **terminal view**.
- **Terminal view:** `@xterm/xterm` + `@xterm/addon-fit`, connected to `/ws/proxmox/console?script=<slug>`; send input/resize, write output; show exit code; offer Close. Dark terminal theme.
- Deps: `@xterm/xterm`, `@xterm/addon-fit`. Types from `lib/types.ts` mirroring the shapes above.

## Out of scope (MVP, leave TODOs)
Guest consoles (noVNC), clone/migrate/snapshot, disk/network editing post-create,
cluster/multi-node, qm cloud-init wizard. Manual-create forms can be basic but must
produce a working guest.

---

# Addendum: Docker-in-guest management

Detect and manage Docker **inside** a guest. proxsyno runs on the host, so it reaches
the guest's Docker daemon through an exec transport — never a network Docker socket:

- **LXC** → `pct exec <vmid> -- <argv>` (always available).
- **VM**  → `qm guest exec <vmid> -- <argv>` (requires `qemu-guest-agent` in the VM;
  detect its absence and surface a clear reason). Parse the JSON it returns
  (`{ "out-data", "err-data", "exitcode" }`); note its output-size limit and degrade
  gracefully for large output (e.g. cap `logs --tail`).

All exec goes through a new `services/guestexec.ts` using the execFile args-array
wrapper. The docker command is itself an **argv array** (e.g.
`["docker","ps","-a","--format","{{json .}}"]`) — no shell, no string interpolation.

## Types
- DockerStatus: `{ dockerInstalled:boolean, dockerVersion?:string, reachable:boolean, transport:"pct"|"agent", reason?:string }`
- DockerContainer: `{ id:string, name:string, image:string, state:"running"|"exited"|"created"|"paused"|"restarting"|"dead", status:string, ports:[{hostIp?:string, hostPort?:number, containerPort:number, proto:"tcp"|"udp"}], createdSec:number }`
- DockerImage: `{ id:string, repo:string, tag:string, sizeBytes:number }`

## REST (base `/api/docker/:type/:vmid`, type∈{qemu,lxc})
> As-built base path. `id` is validated `^[a-zA-Z0-9][a-zA-Z0-9_.-]*$` (anchored
> leading char to block docker option-injection, e.g. an id of `--help`).
- `GET  /status` → `DockerStatus`. Probes the guest: running? transport reachable?
  `docker version` present? Cache briefly per guest.
- `GET  /containers` → `DockerContainer[]` (`docker ps -a --format "{{json .}}"`).
- `POST /containers/:id/:action` — `action∈{start,stop,restart,remove}` → `202`
  (`docker <action> <id>`; remove = `docker rm -f`). Validate `id` as `^[a-zA-Z0-9_.-]+$`.
- `GET  /containers/:id/logs?tail=200` → `{ logs:string }` (`docker logs --tail <n> <id>`,
  `n` clamped 1..2000). MVP returns a tail snapshot, not a stream.
- `POST /containers` (run) body
  `{ image, name?, ports?:[{hostPort,containerPort,proto?="tcp"}], volumes?:[{hostPath,containerPath,readOnly?}], env?:[{key,value}], restart?:"no"|"always"|"unless-stopped"|"on-failure", network?, command? }`
  → builds a `docker run -d` argv (`--name`, `-p host:container/proto`, `-v host:container[:ro]`,
  `-e KEY=VALUE`, `--restart`, `--network`, image, [command…]) → `201 {id}`.
  zod-validate: image `^[a-z0-9][a-z0-9._/:@-]*$`, ports numeric 1..65535, env keys
  `^[A-Za-z_][A-Za-z0-9_]*$`, paths absolute. Reject anything else.
- `GET  /images` → `DockerImage[]` (`docker images --format "{{json .}}"`). (optional)

## Frontend
- Guests that report `dockerInstalled` get a **Docker** affordance (badge on the row +
  a Docker panel/tab in the guest detail). If `qemu-guest-agent` is missing on a VM,
  show the reason and a hint to install it.
- **Containers table**: name, image, state badge (running=emerald, exited=zinc,
  restarting=amber, dead=rose), ports, created. Row actions Start/Stop/Restart/Remove
  (confirm on Stop/Remove). A **Logs** action opens a modal with the tail (mono, dark).
- **+ Run container**: a form matching the `POST /containers` body — image, name,
  port mappings (repeatable rows), volume mounts (repeatable), env vars (repeatable),
  restart policy, optional network/command. Client-validate; server is source of truth.
- Follows `docs/ui-conventions.md` like every other page.

## Out of scope (MVP, leave TODOs)
docker compose, exec-into-container terminal, live log streaming (use tail), image
pull/build UI, registry auth, swarm/k8s.

---

# Addendum: DSM-style desktop shell

Replace the sidebar+routed-pages layout with a **desktop environment** (Synology
DSM feel) using the dark palette from docs/ui-conventions.md.

- **Auth/routing:** `/login` stays its own route. Everything else renders the
  **Desktop** (single authenticated surface). Feature "pages" are no longer routes —
  they are **apps** opened as windows. Keep react-router only for login vs desktop.
- **Desktop:** full-viewport `bg-zinc-950` wallpaper (subtle gradient/texture ok),
  a grid of **desktop icons** (top-left) that launch apps, the window layer, and the
  taskbar.
- **Window manager** (state in a context/store): track `{id, appKey, title, x, y, w, h, z, minimized, maximized, focused}`; ops open/close/focus/move/resize/minimize/maximize/restore. New windows cascade; clicking focuses + raises z; one window focused at a time. Persist nothing (in-memory) for MVP.
- **AppWindow:** `bg-zinc-900` frame, titlebar (app icon + title + minimize/maximize/close buttons, orange focus accent on the active window), **draggable by titlebar**, **resizable** from edges/corners (min size guard), double-click titlebar = maximize toggle. Body hosts the app component, scrolls internally.
- **Taskbar** (bottom): a **launcher** ("apps" button → menu/grid of all apps), a button per open window (click = focus or restore; shows minimized state), a live mini CPU/mem readout (reuse the /ws/system hook), the logged-in user + logout, and a clock.
- **App registry:** `{ key, title, icon (lucide), component, defaultSize }` for Dashboard, Storage, Shares, Users, Files, Virtualization. **Virtualization is included only when `GET /api/proxmox/available` → isProxmox** (carry over the existing gate). Docker app will register here later.
- Reuse the existing page components as window bodies unchanged where possible; drop the now-unused AppShell/Sidebar/TopBar. Comply with docs/ui-conventions.md (no double borders, orange accent, icons, no native dialogs).

---

# Addendum: guest VNC console

In-browser noVNC console for a qemu VM or LXC, app key `console` surfaced as the
**Console** tab in guest detail.

- **WS** `/ws/pve/console?node=&type=&vmid=` (cookie-auth on upgrade, 30s heartbeat).
  The backend opens a Proxmox `vncproxy` via the **local `:8006` HTTP API** — *not*
  `pvesh create vncproxy`, which the CLI overrides to run the proxy in the
  foreground (it blocks and never returns the `{port,ticket}` JSON). It authenticates
  with a `root@pam` ticket + CSRF token **minted from the cluster authkey** via
  `PVE::AccessControl` (we run as root; no stored secret, no password). The returned
  `port` is range-checked 5900–5999 and only `127.0.0.1` is ever dialed.
- Wire protocol: backend sends ONE JSON text frame `{type:"vnc-ticket", ticket}` (or
  `{type:"error", message}`), then bridges the socket as a raw binary RFB pipe to the
  local vncterm. The browser hands the still-open socket to noVNC's `RFB` with
  `credentials.password = ticket`. `node` rejects `..`; vite build target `es2022`
  (noVNC's entry uses top-level await).

---

# Addendum: Synology Station apps

NAS-side apps (NOT Proxmox-gated). All routers mount after `requireAuth`; all paths
that touch the filesystem resolve through the `/mnt` realpath jail (`fsbrowse.ts`).

## Download Station — `/api/downloads`
- Engine: `aria2c` RPC daemon (http/https/magnet/torrent) when installed, else a
  `wget` per-job fallback (http/https only; magnet rejected `400`). `GET /capabilities`
  → `{engine:"aria2"|"wget", magnet:boolean}`.
- `GET /` list jobs; `POST /` `{url, dest}` (url `^(https?|magnet):`, dest jailed);
  `POST /:id/:action` (pause|resume|cancel); `DELETE /:id`. Jobs persisted to
  `${PROXSYNO_DATA_DIR|/var/lib/proxsyno}/downloads.json`; interrupted → `paused` on
  restart. UI polls (`refetchInterval` 1.5s).

## Photos — `/api/photos`
- Read-only media gallery over the jail. `GET /?path=<dir>` → `{path, hasThumbnailer,
  folders[], items[]}`; `GET /raw?path=` (Range stream); `GET /thumb?path=` (cached
  320px via vipsthumbnail/ffmpeg when present, else scaled original); `DELETE /?path=`.
  Exts: jpg/jpeg/png/gif/webp/heic, mp4/mov/webm/mkv. Lightbox with next/prev.

## Note Station — `/api/notes`
- Markdown notebooks. `GET /?q=` → `{notebooks, notes}` (body-less summaries);
  `GET/POST/PUT/DELETE /:id`. Server-generated UUID ids (never a client path); atomic
  tmp-then-rename store under `${NOTES_DIR|/var/lib/proxsyno/notes}`; body ≤ 200k.
  3-pane UI, dependency-free markdown→HTML (escaped, href-whitelisted).

## Surveillance — `/api/surveillance` (Frigate)
- Authenticated reverse proxy to a Frigate NVR (`FRIGATE_URL`, default
  `http://127.0.0.1:5000`; set in `/etc/proxsyno/proxsyno.env`). `GET /status` →
  `{available, ui, version?, cameras?}` — returns `available:false` (HTTP 200, no
  throw) when Frigate is down so the UI shows a "start LXC 100" state. `GET /config`,
  `/events`, `/camera/:name/latest.jpg`, `/event/:id/{thumbnail,snapshot}.jpg` proxy
  Frigate; `:name`/`:id` validated, `..` rejected, no caller cookies forwarded, media
  streamed not buffered.
