/**
 * Per-user UI preferences — small JSON blobs (desktop icon layout today, more
 * later) stored one file per user under a data dir. Follows the same atomic
 * write-tmp-then-rename + serialised-mutation pattern as the notes store.
 *
 * The filename is the username. Usernames are already constrained to a Unix-name
 * charset at login, but we re-validate here (and confirm the resolved path stays
 * inside the prefs dir) before ever touching the filesystem.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ApiError } from "../util/errors.js";

const PREFS_DIR = path.resolve(
  process.env.PROXSYNO_DATA_DIR && process.env.PROXSYNO_DATA_DIR !== ""
    ? path.join(process.env.PROXSYNO_DATA_DIR, "prefs")
    : "/var/lib/proxsyno/prefs",
);

// Cap the stored blob so a client can't grow a user's prefs file unbounded.
const MAX_BYTES = 64 * 1024;
const SAFE_USER = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,63}$/;

export type Prefs = Record<string, unknown>;

function userFile(user: string): string {
  if (!SAFE_USER.test(user) || user.includes("..")) {
    throw ApiError.badRequest("Invalid user");
  }
  const file = path.join(PREFS_DIR, `${user}.json`);
  // Defence in depth: the resolved file must live directly in PREFS_DIR.
  if (path.dirname(file) !== PREFS_DIR) throw ApiError.badRequest("Invalid user");
  return file;
}

async function readPrefs(user: string): Promise<Prefs> {
  try {
    const raw = await readFile(userFile(user), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Prefs;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

async function writePrefs(user: string, prefs: Prefs): Promise<void> {
  const file = userFile(user);
  await mkdir(PREFS_DIR, { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(prefs), { mode: 0o600 });
  await rename(tmp, file);
}

// Serialise per-user read-modify-write cycles so two tabs can't clobber.
const locks = new Map<string, Promise<unknown>>();
function withUserLock<T>(user: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(user) ?? Promise.resolve();
  const result = prev.then(fn, fn);
  locks.set(
    user,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}

/** Return all preferences for a user ({} if none saved yet). */
export function getPrefs(user: string): Promise<Prefs> {
  return readPrefs(user);
}

/** Set one top-level section, leaving the others intact. Returns the merged set. */
export function setPrefSection(user: string, section: string, value: unknown): Promise<Prefs> {
  return withUserLock(user, async () => {
    const current = await readPrefs(user);
    const merged: Prefs = { ...current, [section]: value };
    if (JSON.stringify(merged).length > MAX_BYTES) {
      throw ApiError.badRequest("Preferences too large");
    }
    await writePrefs(user, merged);
    return merged;
  });
}
