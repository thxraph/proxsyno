/**
 * Per-user UI preferences. Mounted behind requireAuth, so the identity is the
 * session user — a client can only ever read/write its own prefs.
 */
import { Router } from "express";
import { z } from "zod";
import { getPrefs, setPrefSection } from "../services/prefs.js";
import { ApiError, asyncHandler } from "../util/errors.js";

export const prefsRouter = Router();

// Desktop icon layout: { [appKey]: { x, y } }. Bounded in count and key length.
const iconPositionsSchema = z
  .record(
    z.string().regex(/^[a-z0-9_-]+$/i).max(64),
    z.object({ x: z.number().finite(), y: z.number().finite() }),
  )
  .refine((m) => Object.keys(m).length <= 200, "Too many icons");

// GET /api/prefs → all preferences for the current user.
prefsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = req.user?.name;
    if (!user) throw ApiError.unauthorized();
    res.json(await getPrefs(user));
  }),
);

// PUT /api/prefs/desktop-icons → replace the icon-layout section.
prefsRouter.put(
  "/desktop-icons",
  asyncHandler(async (req, res) => {
    const user = req.user?.name;
    if (!user) throw ApiError.unauthorized();
    const positions = iconPositionsSchema.parse(req.body);
    const merged = await setPrefSection(user, "desktop-icons", positions);
    res.json(merged["desktop-icons"]);
  }),
);
