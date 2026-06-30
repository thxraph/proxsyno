/**
 * Docker-in-guest routes: detect and manage a Docker daemon running INSIDE a
 * Proxmox guest. Mounted at /api/docker; every path is scoped by guest
 * (:type/:vmid). All bodies/params are zod-validated; every shell-out lives in
 * services/dockerguest.ts behind the args-array exec wrapper (no shell strings).
 */
import { Router } from "express";
import { z } from "zod";
import {
  containerAction,
  getLogs,
  getStatus,
  inspectContainer,
  listContainers,
  runContainer,
  type RunContainerInput,
} from "../services/dockerguest.js";
import { asyncHandler } from "../util/errors.js";

export const dockerRouter = Router();

// --- shared validators -----------------------------------------------------

const typeParam = z.enum(["qemu", "lxc"]);
const vmidParam = z.coerce.number().int().positive();
// Container id or name as accepted by docker on the CLI. Must NOT start with '-':
// the id is passed as a bare argv element (no shell), so a leading dash would be
// parsed by docker itself as an option (option injection) — real ids/names never
// start with a dash.
const idParam = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, "invalid container id").max(128);
const actionParam = z.enum(["start", "stop", "restart", "remove"]);

// `docker run` create body (mirrors the SPEC addendum). Every interpolated token
// is constrained so it cannot smuggle extra options into a docker argv element.
const portSchema = z.object({
  hostPort: z.number().int().min(1).max(65535),
  containerPort: z.number().int().min(1).max(65535),
  proto: z.enum(["tcp", "udp"]).optional().default("tcp"),
});

const dockerPathSchema = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^\/[^\0\n\r:]*$/, "must be an absolute path without ':' or control characters");

const volumeSchema = z.object({
  hostPath: dockerPathSchema,
  containerPath: dockerPathSchema,
  readOnly: z.boolean().optional().default(false),
});

const envSchema = z.object({
  key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "invalid env var name"),
  value: z.string().max(4096).regex(/^[^\0\n\r]*$/, "value has control characters"),
});

const createSchema = z.object({
  image: z.string().regex(/^[a-z0-9][a-z0-9._/:@-]*$/, "invalid image reference").max(256),
  name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/, "invalid container name").optional(),
  ports: z.array(portSchema).max(64).optional().default([]),
  volumes: z.array(volumeSchema).max(64).optional().default([]),
  env: z.array(envSchema).max(128).optional().default([]),
  restart: z.enum(["no", "always", "unless-stopped", "on-failure"]).optional(),
  network: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/, "invalid network name").optional(),
  command: z
    .array(z.string().min(1).max(1024).regex(/^[^\0\n\r]*$/, "control characters not allowed"))
    .max(64)
    .optional()
    .default([]),
});

const logsQuerySchema = z.object({
  tail: z.coerce.number().int().min(1).max(2000).optional().default(200),
});

// --- routes ----------------------------------------------------------------

// GET /api/docker/:type/:vmid/status
dockerRouter.get(
  "/:type/:vmid/status",
  asyncHandler(async (req, res) => {
    const type = typeParam.parse(req.params.type);
    const vmid = vmidParam.parse(req.params.vmid);
    res.json(await getStatus(type, vmid));
  }),
);

// GET /api/docker/:type/:vmid/containers
dockerRouter.get(
  "/:type/:vmid/containers",
  asyncHandler(async (req, res) => {
    const type = typeParam.parse(req.params.type);
    const vmid = vmidParam.parse(req.params.vmid);
    res.json(await listContainers(type, vmid));
  }),
);

// GET /api/docker/:type/:vmid/containers/:id
dockerRouter.get(
  "/:type/:vmid/containers/:id",
  asyncHandler(async (req, res) => {
    const type = typeParam.parse(req.params.type);
    const vmid = vmidParam.parse(req.params.vmid);
    const id = idParam.parse(req.params.id);
    res.json(await inspectContainer(type, vmid, id));
  }),
);

// GET /api/docker/:type/:vmid/containers/:id/logs?tail=200
dockerRouter.get(
  "/:type/:vmid/containers/:id/logs",
  asyncHandler(async (req, res) => {
    const type = typeParam.parse(req.params.type);
    const vmid = vmidParam.parse(req.params.vmid);
    const id = idParam.parse(req.params.id);
    const { tail } = logsQuerySchema.parse(req.query);
    res.json({ logs: await getLogs(type, vmid, id, tail) });
  }),
);

// POST /api/docker/:type/:vmid/containers/:id/:action  (start|stop|restart|remove)
dockerRouter.post(
  "/:type/:vmid/containers/:id/:action",
  asyncHandler(async (req, res) => {
    const type = typeParam.parse(req.params.type);
    const vmid = vmidParam.parse(req.params.vmid);
    const id = idParam.parse(req.params.id);
    const action = actionParam.parse(req.params.action);
    await containerAction(type, vmid, id, action);
    res.status(202).json({ ok: true });
  }),
);

// POST /api/docker/:type/:vmid/containers  (create via `docker run -d`)
dockerRouter.post(
  "/:type/:vmid/containers",
  asyncHandler(async (req, res) => {
    const type = typeParam.parse(req.params.type);
    const vmid = vmidParam.parse(req.params.vmid);
    const body = createSchema.parse(req.body) as RunContainerInput;
    const id = await runContainer(type, vmid, body);
    res.status(201).json({ id });
  }),
);
