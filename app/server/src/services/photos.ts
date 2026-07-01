/**
 * Media gallery service (Synology-Photos style). Read-only browse + delete of
 * image/video files under the jailed FILES_ROOT. Every client path is funnelled
 * through fsbrowse's realpath jail (security rule #2) so traversal and symlink
 * escapes are rejected before we ever touch a file.
 *
 * Thumbnails are generated with `vipsthumbnail` or `ffmpeg` when present and
 * cached on disk; when no thumbnailer is installed we degrade gracefully and the
 * route streams the original (the browser scales it down).
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../config.js";
import { ApiError } from "../util/errors.js";
import { run } from "../util/exec.js";
import { resolveExistingInsideJail } from "./fsbrowse.js";

const ROOT = config.filesRoot;

// Where generated thumbnails are cached. Keyed by a hash of path+size+mtime so a
// changed/replaced file invalidates its cached thumbnail automatically.
const THUMB_DIR = path.join(os.tmpdir(), "proxsyno-photo-thumbs");

export type MediaKind = "image" | "video";

// Extension → kind + Content-Type. Lowercase, no leading dot.
const IMAGE_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
};
const VIDEO_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
};

export interface MediaItem {
  name: string;
  /** Absolute path inside the jail — pass straight back to raw/thumb/delete. */
  path: string;
  sizeBytes: number;
  mtimeMs: number;
  kind: MediaKind;
}

export interface MediaFolder {
  name: string;
  path: string;
}

export interface MediaListing {
  path: string;
  hasThumbnailer: boolean;
  folders: MediaFolder[];
  items: MediaItem[];
}

export interface ResolvedMedia {
  absPath: string;
  kind: MediaKind;
  contentType: string;
}

function ext(name: string): string {
  return path.extname(name).slice(1).toLowerCase();
}

function kindFor(name: string): MediaKind | null {
  const e = ext(name);
  if (e in IMAGE_TYPES) return "image";
  if (e in VIDEO_TYPES) return "video";
  return null;
}

function contentTypeFor(name: string): string {
  const e = ext(name);
  return IMAGE_TYPES[e] ?? VIDEO_TYPES[e] ?? "application/octet-stream";
}

// ---------------------------------------------------------------------------
// Thumbnailer detection (cached after first probe)
// ---------------------------------------------------------------------------

interface Thumbnailers {
  image: "vipsthumbnail" | "ffmpeg" | null;
  video: "ffmpeg" | null;
}

let thumbnailers: Thumbnailers | undefined;

async function whichOk(bin: string): Promise<boolean> {
  try {
    const r = await run("which", [bin], { allowNonZeroExit: true });
    return r.code === 0;
  } catch {
    return false;
  }
}

async function getThumbnailers(): Promise<Thumbnailers> {
  if (!thumbnailers) {
    const hasVips = await whichOk("vipsthumbnail");
    const hasFf = await whichOk("ffmpeg");
    thumbnailers = {
      image: hasVips ? "vipsthumbnail" : hasFf ? "ffmpeg" : null,
      video: hasFf ? "ffmpeg" : null,
    };
  }
  return thumbnailers;
}

export async function hasAnyThumbnailer(): Promise<boolean> {
  const t = await getThumbnailers();
  return Boolean(t.image || t.video);
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export async function listMedia(clientPath: string): Promise<MediaListing> {
  const dir = await resolveExistingInsideJail(clientPath);
  const st = await fs.stat(dir);
  if (!st.isDirectory()) {
    throw ApiError.badRequest("Path is not a directory");
  }

  const dirents = await fs.readdir(dir, { withFileTypes: true });
  const folders: MediaFolder[] = [];
  const items: MediaItem[] = [];

  await Promise.all(
    dirents.map(async (d) => {
      // Skip symlinks (and anything non-regular) to keep the jail unambiguous.
      if (d.isSymbolicLink()) return;
      const full = path.join(dir, d.name);
      if (d.isDirectory()) {
        folders.push({ name: d.name, path: full });
        return;
      }
      if (!d.isFile()) return;
      const kind = kindFor(d.name);
      if (!kind) return;
      try {
        const s = await fs.stat(full);
        items.push({
          name: d.name,
          path: full,
          sizeBytes: s.size,
          mtimeMs: Math.round(s.mtimeMs),
          kind,
        });
      } catch {
        // Unreadable entry — skip it rather than fail the whole listing.
      }
    }),
  );

  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  folders.sort(byName);
  items.sort(byName);

  return { path: dir, hasThumbnailer: await hasAnyThumbnailer(), folders, items };
}

// ---------------------------------------------------------------------------
// Resolve a single media file for streaming / thumbnailing / deletion
// ---------------------------------------------------------------------------

export async function resolveMediaFile(clientPath: string): Promise<ResolvedMedia> {
  const absPath = await resolveExistingInsideJail(clientPath);
  const st = await fs.stat(absPath);
  if (st.isDirectory()) {
    throw ApiError.badRequest("Path is not a file");
  }
  const kind = kindFor(absPath);
  if (!kind) {
    throw ApiError.badRequest("Not a supported media file");
  }
  return { absPath, kind, contentType: contentTypeFor(absPath) };
}

export async function deleteMedia(clientPath: string): Promise<void> {
  const { absPath } = await resolveMediaFile(clientPath);
  if (absPath === ROOT) {
    throw ApiError.forbidden("Refusing to delete the gallery root");
  }
  await fs.rm(absPath);
}

// ---------------------------------------------------------------------------
// Thumbnail generation (best-effort; returns null when unavailable)
// ---------------------------------------------------------------------------

/**
 * Return the path to a cached 320px JPEG thumbnail for `absPath`, generating it
 * if needed. Returns null when no suitable thumbnailer is installed or
 * generation fails — callers should then fall back to the original.
 */
export async function thumbnailPath(media: ResolvedMedia): Promise<string | null> {
  const tools = await getThumbnailers();
  const tool = media.kind === "video" ? tools.video : tools.image;
  if (!tool) return null;

  const st = await fs.stat(media.absPath);
  const key = createHash("sha1")
    .update(`${media.absPath}:${st.size}:${Math.round(st.mtimeMs)}`)
    .digest("hex");
  const out = path.join(THUMB_DIR, `${key}.jpg`);

  try {
    await fs.access(out);
    return out; // cache hit
  } catch {
    // miss — generate below
  }

  await fs.mkdir(THUMB_DIR, { recursive: true });
  try {
    if (media.kind === "image" && tool === "vipsthumbnail") {
      // -o accepts an output spec with a per-file option suffix.
      await run("vipsthumbnail", [media.absPath, "-s", "320x320", "-o", `${out}[Q=80]`]);
    } else if (media.kind === "image") {
      await run("ffmpeg", ["-y", "-i", media.absPath, "-vf", "scale=320:-1", "-frames:v", "1", out]);
    } else {
      // video: grab a frame ~1s in and scale it.
      await run("ffmpeg", [
        "-y",
        "-ss",
        "1",
        "-i",
        media.absPath,
        "-frames:v",
        "1",
        "-vf",
        "scale=320:-1",
        out,
      ]);
    }
    await fs.access(out);
    return out;
  } catch {
    // Generation failed (corrupt file, codec, etc.) — fall back to original.
    return null;
  }
}
