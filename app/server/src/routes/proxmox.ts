/**
 * Virtualization (Proxmox) routes: availability, guest inventory + lifecycle,
 * create-form options, manual VM/LXC creation, and the community-scripts
 * catalog. All bodies/params are zod-validated; every shell-out lives in
 * services/proxmox.ts behind the args-array exec wrapper.
 *
 * The interactive console WebSocket (/ws/proxmox/console) is wired up in
 * index.ts since it attaches to the HTTP server, not this router.
 */
import { Router } from "express";
import { z } from "zod";
import {
  createLxc,
  createVm,
  getAvailable,
  getOptions,
  getScripts,
  guestAction,
  listGuests,
  OS_TYPES,
} from "../services/proxmox.js";
import { asyncHandler } from "../util/errors.js";

export const proxmoxRouter = Router();

// --- shared validators ----------------------------------------------------

const typeParam = z.enum(["qemu", "lxc"]);
const actionParam = z.enum(["start", "stop", "shutdown", "reboot"]);
const vmidParam = z.coerce.number().int().positive();

// Storage names, bridges, and volids are interpolated into single argv tokens
// (e.g. "<storage>:<diskGB>"); they never reach a shell, but we still constrain
// them so they can't smuggle extra commas/options into the qm/pct option parser.
const storageName = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/, "invalid storage name");
const bridgeName = z.string().regex(/^vmbr\d+$/, "invalid bridge name");
const volid = z.string().min(1).max(256).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,254}$/, "invalid volume id");
// VM names must be DNS-style for qm; LXC hostnames likewise.
const hostName = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/, "must be a valid hostname");

const cores = z.number().int().min(1).max(512);
const memoryMB = z.number().int().min(16).max(4 * 1024 * 1024);
const diskGB = z.number().int().min(1).max(65536);

const vmBodySchema = z.object({
  name: hostName,
  cores,
  memoryMB,
  diskGB,
  storage: storageName,
  isoVolid: volid.optional(),
  bridge: bridgeName,
  ostype: z.enum(OS_TYPES).optional(),
});

const lxcBodySchema = z.object({
  hostname: hostName,
  templateVolid: volid,
  cores,
  memoryMB,
  diskGB,
  storage: storageName,
  bridge: bridgeName,
  password: z.string().min(1).max(128),
  unprivileged: z.boolean().optional().default(true),
  startOnCreate: z.boolean().optional().default(false),
});

// --- routes ----------------------------------------------------------------

// GET /api/proxmox/available
proxmoxRouter.get(
  "/available",
  asyncHandler(async (_req, res) => {
    res.json(await getAvailable());
  }),
);

// GET /api/proxmox/guests
proxmoxRouter.get(
  "/guests",
  asyncHandler(async (_req, res) => {
    res.json(await listGuests());
  }),
);

// POST /api/proxmox/guests/:type/:vmid/:action
proxmoxRouter.post(
  "/guests/:type/:vmid/:action",
  asyncHandler(async (req, res) => {
    const type = typeParam.parse(req.params.type);
    const vmid = vmidParam.parse(req.params.vmid);
    const action = actionParam.parse(req.params.action);
    await guestAction(type, vmid, action);
    res.status(202).json({ ok: true });
  }),
);

// GET /api/proxmox/options
proxmoxRouter.get(
  "/options",
  asyncHandler(async (_req, res) => {
    res.json(await getOptions());
  }),
);

// POST /api/proxmox/vm
proxmoxRouter.post(
  "/vm",
  asyncHandler(async (req, res) => {
    const body = vmBodySchema.parse(req.body);
    const vmid = await createVm(body);
    res.status(201).json({ vmid });
  }),
);

// POST /api/proxmox/lxc
proxmoxRouter.post(
  "/lxc",
  asyncHandler(async (req, res) => {
    const body = lxcBodySchema.parse(req.body);
    const vmid = await createLxc(body);
    res.status(201).json({ vmid });
  }),
);

// GET /api/proxmox/scripts
proxmoxRouter.get(
  "/scripts",
  asyncHandler(async (_req, res) => {
    res.json(await getScripts());
  }),
);
