/**
 * Surveillance Station — an authenticated reverse proxy in front of Frigate
 * (services/surveillance.ts). The browser only ever talks to these routes, so
 * Frigate itself stays unreachable from the client.
 *
 * Mounted (by index.ts) at /api/surveillance, behind requireAuth.
 */
import { Router } from "express";
import { z } from "zod";
import { getStatus, pipeFrigate } from "../services/surveillance.js";
import { ApiError, asyncHandler } from "../util/errors.js";

export const surveillanceRouter = Router();

// Camera names and event ids are interpolated into the Frigate path; constrain
// them so they can't escape the intended endpoint (no slashes, no dots/traversal
// for camera names). Frigate event ids look like "<epoch>-<rand>".
const cameraName = z.string().regex(/^[a-zA-Z0-9_-]+$/, "invalid camera name");
// Event ids carry a '.' (e.g. "1719765432.123456-abcde"), so dots are allowed,
// but reject ".." so the id can't normalise the proxied Frigate path upward.
const eventId = z
  .string()
  .regex(/^[a-zA-Z0-9_.-]+$/, "invalid event id")
  .refine((v) => !v.includes(".."), "invalid event id");

/** Build a safe, URL-encoded querystring from whitelisted scalar params. */
function forwardQuery(query: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (typeof v === "string") sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

async function proxy(path: string, res: import("express").Response): Promise<void> {
  const result = await pipeFrigate(path, res);
  if (!result.ok) {
    throw new ApiError(502, "frigate_unreachable", "Frigate is not reachable");
  }
}

// GET /api/surveillance/status — never errors; {available:false} if LXC is down.
surveillanceRouter.get(
  "/status",
  asyncHandler(async (_req, res) => {
    res.json(await getStatus());
  }),
);

// GET /api/surveillance/config — proxy Frigate /api/config.
surveillanceRouter.get(
  "/config",
  asyncHandler(async (_req, res) => {
    await proxy("/api/config", res);
  }),
);

// GET /api/surveillance/events — proxy Frigate /api/events (recent detections).
surveillanceRouter.get(
  "/events",
  asyncHandler(async (req, res) => {
    const query = { limit: "50", ...(req.query as Record<string, unknown>) };
    await proxy(`/api/events${forwardQuery(query)}`, res);
  }),
);

// GET /api/surveillance/camera/:name/latest.jpg — live snapshot.
surveillanceRouter.get(
  "/camera/:name/latest.jpg",
  asyncHandler(async (req, res) => {
    const name = cameraName.parse(req.params.name);
    await proxy(`/api/${name}/latest.jpg`, res);
  }),
);

// GET /api/surveillance/event/:id/thumbnail.jpg — event thumbnail.
surveillanceRouter.get(
  "/event/:id/thumbnail.jpg",
  asyncHandler(async (req, res) => {
    const id = eventId.parse(req.params.id);
    await proxy(`/api/events/${id}/thumbnail.jpg`, res);
  }),
);

// GET /api/surveillance/event/:id/snapshot.jpg — event snapshot (full frame).
surveillanceRouter.get(
  "/event/:id/snapshot.jpg",
  asyncHandler(async (req, res) => {
    const id = eventId.parse(req.params.id);
    await proxy(`/api/events/${id}/snapshot.jpg`, res);
  }),
);
