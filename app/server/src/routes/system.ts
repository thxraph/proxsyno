/**
 * System info route. The live WebSocket sampler is wired up in index.ts since
 * it attaches to the HTTP server, not the Express router.
 */
import { Router } from "express";
import { getSystemInfo } from "../services/system.js";
import { asyncHandler } from "../util/errors.js";

export const systemRouter = Router();

// GET /api/system
systemRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await getSystemInfo());
  }),
);
