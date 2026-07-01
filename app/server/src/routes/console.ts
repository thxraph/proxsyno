/**
 * Guest VNC console — the REST half of the handshake. The browser POSTs here to
 * mint a Proxmox vncproxy; it gets back the VNC password (`ticket`) and a
 * single-use `token`. It then opens the RFB WebSocket at
 * /ws/pve/console?token=... which swaps the token for the pre-created proxy and
 * bridges raw bytes (see index.ts). Splitting it this way lets noVNC own the
 * socket from `open`, which it requires to start the RFB handshake.
 */
import { Router } from "express";
import { z } from "zod";
import { createVncProxy, registerProxy } from "../services/pveconsole.js";
import { asyncHandler } from "../util/errors.js";

export const consoleRouter = Router();

const schema = z.object({
  node: z
    .string()
    .regex(/^[a-zA-Z0-9._-]+$/)
    .refine((v) => !v.includes(".."), "Invalid node"),
  type: z.enum(["qemu", "lxc"]),
  vmid: z.number().int().positive(),
});

// POST /api/console/vnc → { ticket, token }
consoleRouter.post(
  "/vnc",
  asyncHandler(async (req, res) => {
    const params = schema.parse(req.body);
    const proxy = await createVncProxy(params);
    const token = registerProxy(proxy);
    res.json({ ticket: proxy.ticket, token });
  }),
);
