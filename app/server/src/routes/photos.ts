/**
 * Media gallery routes. Thin handlers over services/photos.ts, which enforces
 * the realpath jail. Read-only browse + raw/thumbnail streaming + delete.
 */
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import {
  deleteMedia,
  listMedia,
  resolveMediaFile,
  thumbnailPath,
  type ResolvedMedia,
} from "../services/photos.js";
import { ApiError, asyncHandler } from "../util/errors.js";
import { pathSchema } from "../util/validate.js";

export const photosRouter = Router();

const pathQuerySchema = z.object({ path: pathSchema });

/**
 * Stream a file with HTTP Range support (so the lightbox can seek videos) and a
 * caller-controlled Content-Type. Served inline, never as an attachment.
 */
async function streamFile(req: Request, res: Response, absPath: string, contentType: string): Promise<void> {
  const st = await fs.stat(absPath);
  const total = st.size;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=3600");

  const range = req.headers.range;
  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
  if (match && (match[1] || match[2])) {
    let start: number;
    let end: number;
    if (match[1]) {
      start = Number.parseInt(match[1], 10);
      end = match[2] ? Number.parseInt(match[2], 10) : total - 1;
    } else {
      // Suffix range (RFC 7233): "bytes=-N" means the LAST N bytes.
      const n = Number.parseInt(match[2]!, 10);
      start = Math.max(total - n, 0);
      end = total - 1;
    }
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
      res.status(416).setHeader("Content-Range", `bytes */${total}`).end();
      return;
    }
    end = Math.min(end, total - 1);
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
    res.setHeader("Content-Length", String(end - start + 1));
    pipe(res, createReadStream(absPath, { start, end }));
    return;
  }

  res.setHeader("Content-Length", String(total));
  pipe(res, createReadStream(absPath));
}

function pipe(res: Response, stream: ReturnType<typeof createReadStream>): void {
  stream.on("error", () => {
    if (!res.headersSent) res.status(500);
    res.end();
  });
  stream.pipe(res);
}

// GET /api/photos?path=<dir>  -> folders + media items in that directory
photosRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { path: p } = pathQuerySchema.parse(req.query);
    res.json(await listMedia(p));
  }),
);

// GET /api/photos/raw?path=<file>  -> stream the original (Range-enabled)
photosRouter.get(
  "/raw",
  asyncHandler(async (req, res) => {
    const { path: p } = pathQuerySchema.parse(req.query);
    const media = await resolveMediaFile(p);
    await streamFile(req, res, media.absPath, media.contentType);
  }),
);

// GET /api/photos/thumb?path=<file>  -> cached thumbnail, or the scaled original
photosRouter.get(
  "/thumb",
  asyncHandler(async (req, res) => {
    const { path: p } = pathQuerySchema.parse(req.query);
    const media: ResolvedMedia = await resolveMediaFile(p);
    const thumb = await thumbnailPath(media);
    if (thumb) {
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "private, max-age=86400");
      pipe(res, createReadStream(thumb));
      return;
    }
    // No thumbnailer: an image can still be scaled by the browser; a video frame
    // cannot be turned into an <img>, so signal "no thumbnail available".
    if (media.kind === "image") {
      await streamFile(req, res, media.absPath, media.contentType);
      return;
    }
    throw new ApiError(415, "no_thumbnail", "No thumbnail available for this file");
  }),
);

// DELETE /api/photos?path=<file>  -> 204
photosRouter.delete(
  "/",
  asyncHandler(async (req, res) => {
    const { path: p } = pathQuerySchema.parse(req.query);
    await deleteMedia(p);
    res.status(204).end();
  }),
);
