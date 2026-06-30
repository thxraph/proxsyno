/**
 * Proxmox API passthrough: ANY /api/pve/<proxmox-path> maps to a pvesh call.
 *
 *   GET    /api/pve/nodes/pve/qemu/100/config   -> pvesh get    /nodes/pve/qemu/100/config
 *   POST   /api/pve/nodes/pve/qemu/100/status/start
 *   PUT    /api/pve/nodes/pve/qemu/100/config   (body = params)
 *   DELETE /api/pve/nodes/pve/qemu/100
 *
 * Mounted behind requireAuth, so only admins reach it.
 */
import { Router } from "express";
import { methodToVerb, pveRequest } from "../services/pve.js";
import { ApiError, asyncHandler } from "../util/errors.js";

export const pveRouter = Router();

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Catch-all: handles every method + sub-path. Inside this router req.path is the
// portion after the /api/pve mount, i.e. the bare Proxmox API path.
pveRouter.use(
  asyncHandler(async (req, res) => {
    const verb = methodToVerb(req.method);
    if (!verb) throw ApiError.badRequest(`unsupported method: ${req.method}`);

    const params: Record<string, unknown> = {
      ...(req.query as Record<string, unknown>),
      ...(isPlainObject(req.body) ? req.body : {}),
    };

    const result = await pveRequest(verb, req.path, params);
    if (!result.ok) {
      res
        .status(result.status)
        .json({ error: { code: "pve_error", message: result.error ?? "Proxmox API error" } });
      return;
    }
    res.json({ data: result.data });
  }),
);
