/**
 * SMB + NFS share routes. All bodies are zod-validated; share names use the
 * mandated NAME_REGEX. System integration lives in services/samba.ts.
 */
import { Router } from "express";
import { z } from "zod";
import {
  deleteNfsExport,
  deleteSmbShare,
  listShares,
  upsertNfsExport,
  upsertSmbShare,
  type NfsExport,
  type SmbShare,
} from "../services/samba.js";
import { ApiError, asyncHandler } from "../util/errors.js";
import { nameSchema, pathSchema } from "../util/validate.js";

export const sharesRouter = Router();

const smbBodySchema = z.object({
  name: nameSchema,
  path: pathSchema,
  comment: z.string().max(256).optional(),
  readOnly: z.boolean().optional(),
  guestOk: z.boolean().optional(),
  validUsers: z.array(nameSchema).max(256).optional(),
});

// Body for PUT does not include the name (taken from the URL param).
const smbUpdateSchema = smbBodySchema.omit({ name: true });

const nfsClientSchema = z.object({
  // Host can be an IP, CIDR, hostname, or wildcard like *.example.com.
  host: z.string().min(1).max(255).regex(/^[a-zA-Z0-9_.*:\/-]+$/, "invalid host"),
  // NFS options are a comma-separated token list; restrict to a safe charset.
  options: z.string().max(256).regex(/^[a-zA-Z0-9_,=.-]*$/, "invalid options").optional(),
});

const nfsBodySchema = z.object({
  path: pathSchema,
  clients: z.array(nfsClientSchema).min(1).max(256),
});

function toSmbShare(name: string, body: z.infer<typeof smbUpdateSchema>): SmbShare {
  return {
    name,
    path: body.path,
    ...(body.comment ? { comment: body.comment } : {}),
    readOnly: body.readOnly ?? false,
    guestOk: body.guestOk ?? false,
    validUsers: body.validUsers ?? [],
  };
}

// GET /api/shares
sharesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await listShares());
  }),
);

// POST /api/shares/smb
sharesRouter.post(
  "/smb",
  asyncHandler(async (req, res) => {
    const body = smbBodySchema.parse(req.body);
    const share = await upsertSmbShare(toSmbShare(body.name, body));
    res.status(201).json({ share });
  }),
);

// PUT /api/shares/smb/:name
sharesRouter.put(
  "/smb/:name",
  asyncHandler(async (req, res) => {
    const name = nameSchema.parse(req.params.name);
    const body = smbUpdateSchema.parse(req.body);
    const share = await upsertSmbShare(toSmbShare(name, body));
    res.status(200).json({ share });
  }),
);

// DELETE /api/shares/smb/:name
sharesRouter.delete(
  "/smb/:name",
  asyncHandler(async (req, res) => {
    const name = nameSchema.parse(req.params.name);
    await deleteSmbShare(name);
    res.status(204).end();
  }),
);

// POST /api/shares/nfs
sharesRouter.post(
  "/nfs",
  asyncHandler(async (req, res) => {
    const body = nfsBodySchema.parse(req.body);
    const exp: NfsExport = {
      path: body.path,
      clients: body.clients.map((c) => ({ host: c.host, options: c.options ?? "" })),
    };
    const created = await upsertNfsExport(exp);
    res.status(201).json({ export: created });
  }),
);

// DELETE /api/shares/nfs?path=...
sharesRouter.delete(
  "/nfs",
  asyncHandler(async (req, res) => {
    const path = z.string().min(1).max(4096).safeParse(req.query.path);
    if (!path.success) throw ApiError.badRequest("query parameter 'path' is required");
    await deleteNfsExport(path.data);
    res.status(204).end();
  }),
);
