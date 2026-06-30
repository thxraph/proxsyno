/**
 * Path-jailed file browser. Security rule #2: every path the client supplies is
 * resolved and its realpath verified to stay inside `config.filesRoot`. We
 * reject `..` traversal and refuse to follow symlinks that escape the jail.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { ApiError } from "../util/errors.js";

const ROOT = config.filesRoot;

export interface DirEntry {
  name: string;
  type: "file" | "dir" | "symlink";
  sizeBytes: number;
  mtimeMs: number;
  mode: number;
}

export interface DirListing {
  path: string;
  entries: DirEntry[];
}

/** True if `child` is the same as or nested under `parent`. */
function isInside(parent: string, child: string): boolean {
  if (child === parent) return true;
  const withSep = parent.endsWith(path.sep) ? parent : parent + path.sep;
  return child.startsWith(withSep);
}

/**
 * Resolve a client path to an absolute path INSIDE the jail without touching the
 * filesystem. Rejects traversal that lands outside the root. Used for ops that
 * may target a not-yet-existing path (mkdir, upload, rename target).
 */
export function resolveInsideJail(clientPath: string): string {
  if (typeof clientPath !== "string" || clientPath.length === 0) {
    throw ApiError.badRequest("path is required");
  }
  if (clientPath.includes("\0")) {
    throw ApiError.badRequest("path contains a null byte");
  }

  // Treat the path as relative to ROOT when not absolute; if absolute, it must
  // already be within ROOT. path.resolve collapses any "." / ".." segments.
  const candidate = path.isAbsolute(clientPath)
    ? path.resolve(clientPath)
    : path.resolve(ROOT, clientPath);

  if (!isInside(ROOT, candidate)) {
    throw ApiError.forbidden("Path escapes the file browser root");
  }
  return candidate;
}

/**
 * Like resolveInsideJail, but also verifies the REAL path (after following any
 * symlinks) is still inside the jail. Used for ops on existing targets so a
 * symlink inside the jail can't point out of it.
 */
export async function resolveExistingInsideJail(clientPath: string): Promise<string> {
  const candidate = resolveInsideJail(clientPath);
  let real: string;
  try {
    real = await fs.realpath(candidate);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw ApiError.notFound("Path does not exist");
    }
    throw err;
  }
  if (!isInside(ROOT, real)) {
    throw ApiError.forbidden("Path resolves outside the file browser root (symlink escape)");
  }
  return real;
}

/**
 * Resolve the PARENT of a target that may not exist yet (for mkdir/rename/upload).
 * The parent must already exist and pass the realpath jail check; the basename is
 * then appended. Prevents symlinked parents from escaping the jail.
 */
export async function resolveParentInsideJail(clientPath: string): Promise<string> {
  const candidate = resolveInsideJail(clientPath);
  const parent = path.dirname(candidate);
  const base = path.basename(candidate);
  if (!base || base === "." || base === "..") {
    throw ApiError.badRequest("Invalid target name");
  }
  let realParent: string;
  try {
    realParent = await fs.realpath(parent);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw ApiError.notFound("Parent directory does not exist");
    }
    throw err;
  }
  if (!isInside(ROOT, realParent)) {
    throw ApiError.forbidden("Parent resolves outside the file browser root");
  }
  return path.join(realParent, base);
}

function classify(stats: import("node:fs").Stats | import("node:fs").Dirent): "file" | "dir" | "symlink" {
  if (stats.isSymbolicLink()) return "symlink";
  if (stats.isDirectory()) return "dir";
  return "file";
}

export async function listDir(clientPath: string): Promise<DirListing> {
  const dir = await resolveExistingInsideJail(clientPath);
  const st = await fs.stat(dir);
  if (!st.isDirectory()) {
    throw ApiError.badRequest("Path is not a directory");
  }

  const dirents = await fs.readdir(dir, { withFileTypes: true });
  const entries: DirEntry[] = [];
  for (const d of dirents) {
    const full = path.join(dir, d.name);
    try {
      // lstat so we report symlinks as symlinks rather than their target.
      const s = await fs.lstat(full);
      entries.push({
        name: d.name,
        type: classify(s),
        sizeBytes: s.size,
        mtimeMs: Math.round(s.mtimeMs),
        mode: s.mode & 0o7777,
      });
    } catch {
      // Unreadable entry (e.g. permission) — surface name with zeros.
      entries.push({ name: d.name, type: "file", sizeBytes: 0, mtimeMs: 0, mode: 0 });
    }
  }

  // Directories first, then case-insensitive name order.
  entries.sort((a, b) => {
    if (a.type === "dir" && b.type !== "dir") return -1;
    if (a.type !== "dir" && b.type === "dir") return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  return { path: dir, entries };
}

/** Resolve a file for download, returning its absolute path + basename. */
export async function resolveFileForDownload(
  clientPath: string,
): Promise<{ absPath: string; filename: string }> {
  const abs = await resolveExistingInsideJail(clientPath);
  const st = await fs.stat(abs);
  if (st.isDirectory()) {
    throw ApiError.badRequest("Cannot download a directory");
  }
  return { absPath: abs, filename: path.basename(abs) };
}

/** Resolve a directory the client wants to upload INTO (must exist). */
export async function resolveUploadDir(clientPath: string): Promise<string> {
  const dir = await resolveExistingInsideJail(clientPath);
  const st = await fs.stat(dir);
  if (!st.isDirectory()) {
    throw ApiError.badRequest("Upload target is not a directory");
  }
  return dir;
}

export async function makeDir(clientPath: string): Promise<string> {
  const target = await resolveParentInsideJail(clientPath);
  try {
    await fs.mkdir(target, { recursive: false, mode: 0o755 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw ApiError.conflict("Directory already exists");
    }
    throw err;
  }
  return target;
}

export async function deletePath(clientPath: string): Promise<void> {
  const target = await resolveExistingInsideJail(clientPath);
  if (target === ROOT) {
    throw ApiError.forbidden("Refusing to delete the file browser root");
  }
  // recursive + force handles both files and directory trees, still jailed.
  await fs.rm(target, { recursive: true, force: true });
}

export async function renamePath(fromClient: string, toClient: string): Promise<{ from: string; to: string }> {
  const from = await resolveExistingInsideJail(fromClient);
  if (from === ROOT) {
    throw ApiError.forbidden("Refusing to rename the file browser root");
  }
  const to = await resolveParentInsideJail(toClient);
  try {
    await fs.rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST" || (err as NodeJS.ErrnoException).code === "ENOTEMPTY") {
      throw ApiError.conflict("Target already exists");
    }
    throw err;
  }
  return { from, to };
}
