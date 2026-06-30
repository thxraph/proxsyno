/**
 * Download Station routes. Handlers stay thin; the engine + jail logic lives in
 * services/downloads.ts. URLs are restricted to http/https/magnet and the
 * destination is validated as an absolute path (then jailed in the service).
 */
import { Router } from "express";
import { z } from "zod";
import {
  actionDownload,
  addDownload,
  getCapabilities,
  listDownloads,
  removeDownload,
} from "../services/downloads.js";
import { asyncHandler } from "../util/errors.js";
import { pathSchema } from "../util/validate.js";

export const downloadsRouter = Router();

const urlSchema = z
  .string()
  .min(1)
  .max(8192)
  .refine((v) => /^(https?|magnet):/i.test(v), "URL must be http(s) or magnet");

const addSchema = z.object({ url: urlSchema, dest: pathSchema });
const actionSchema = z.enum(["pause", "resume", "cancel"]);
const idSchema = z.string().uuid();

// GET /api/downloads  -> list jobs (frontend polls this)
downloadsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await listDownloads());
  }),
);

// GET /api/downloads/capabilities -> { engine, magnet }
downloadsRouter.get(
  "/capabilities",
  asyncHandler(async (_req, res) => {
    res.json(await getCapabilities());
  }),
);

// POST /api/downloads  {url, dest}
downloadsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { url, dest } = addSchema.parse(req.body);
    res.status(201).json(await addDownload(url, dest));
  }),
);

// POST /api/downloads/:id/:action  (pause|resume|cancel)
downloadsRouter.post(
  "/:id/:action",
  asyncHandler(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const action = actionSchema.parse(req.params.action);
    res.json(await actionDownload(id, action));
  }),
);

// DELETE /api/downloads/:id  -> remove the job (finished files are left in place)
downloadsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    await removeDownload(id);
    res.status(204).end();
  }),
);
