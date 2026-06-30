## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.


PROJECT INFO STARTS HERE

# CLAUDE.md

**proxsyno** turns a Proxmox-on-RAID server into a Synology-DSM-style NAS — shared
folders, users, storage health, a file browser, and VM/LXC management — without
giving up the host's VMs. It installs a management layer **on the host**; it never
touches disks, RAID, filesystems, or existing guests.

## Two ways it ships
- **(A) Cockpit** — `install.sh` installs Cockpit + 45Drives plugins (SHA256-pinned).
- **(B) Custom app** — `install-app.sh` (or the `bootstrap.sh` one-liner) builds and
  deploys proxsyno's own full-stack app as a systemd service on `:8800`. This is the
  project's focus.

## Architecture (the app)
Monorepo under `app/`:
- `app/server` — Node 20 + Express + TypeScript (**ESM**, NodeNext: relative imports
  end in `.js`). Runs as **root** via systemd because it manages users, Samba, and
  storage. Routes are thin; system integration lives in `src/services/*`.
- `app/web` — React + Vite + TypeScript + Tailwind SPA. In production the backend
  serves `app/web/dist` at `/` and the API under `/api`, all on `:8800`.

`SPEC.md` is the **source of truth** for the API contract and types — read it before
changing endpoints or shared shapes, and keep `app/web/src/lib/types.ts` in sync.

## Non-negotiable security rules
1. **Never** build shell strings from user input. Use the `util/exec.ts` wrapper
   (`execFile`/`spawn` with **args arrays**). The only shell invocation is the
   pinned community-script PTY, whose sole variable is a catalog-validated slug.
2. File browser is **jailed** to `FILES_ROOT` (default `/mnt`) — verify `realpath`
   stays inside; reject `..` and symlink escapes.
3. Every route except `/api/health` and `/api/auth/login` requires auth. Validate
   every body/param with **zod**. Names match `^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,31}$`.
4. Secrets come from env (`/etc/proxsyno/proxsyno.env`), never hardcoded.

## Auth model
PAM login (service `/etc/pam.d/proxsyno`, local `pam_unix` only — no winbind) →
JWT in an httpOnly/SameSite=Strict cookie. `root` (uid 0) and members of
`ADMIN_GROUP` (default `sudo`) may log in. The MVP serves HTTP, so `COOKIE_SECURE`
defaults **off** (a Secure cookie is dropped over http and login silently fails);
turn it on behind a TLS reverse proxy.

## UI conventions
The frontend follows [`docs/ui-conventions.md`](docs/ui-conventions.md): dark
`zinc-950` body / `zinc-900` cards with **no double borders**, `gap-px` edge-to-edge
layout, **orange-400/500** as the single interactive accent (emerald = positive
only, rose = danger), uppercase `text-[10px]` field labels, icons on every header
and primary button, and **no native `alert`/`confirm`/`prompt`** (use the modal /
dialog components). New pages and components must comply.

## Common commands
```bash
make build                       # build app/server + app/web
sudo ./install-app.sh --yes      # build + deploy to /opt/proxsyno, (re)start service
systemctl restart proxsyno       # reload after a redeploy
journalctl -u proxsyno -f        # logs
```
Build artifacts (`node_modules/`, `dist/`) are git-ignored; `package-lock.json` is
committed. After any deploy, **restart the service** (the installer does this; a bare
`enable --now` would not reload new code).
