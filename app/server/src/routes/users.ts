/**
 * NAS user + group routes. Usernames use the mandated NAME_REGEX; destructive
 * operations are guarded to human accounts (uid >= 1000) in the service layer.
 */
import { Router } from "express";
import { z } from "zod";
import {
  assertHumanUser,
  createUser,
  deleteUser,
  listGroups,
  listUsers,
  updateUser,
} from "../services/identities.js";
import { asyncHandler } from "../util/errors.js";
import { nameSchema } from "../util/validate.js";

export const usersRouter = Router();

const passwordSchema = z.string().min(1).max(1024);

const createSchema = z.object({
  name: nameSchema,
  password: passwordSchema,
  groups: z.array(nameSchema).max(64).optional(),
  sambaEnabled: z.boolean().optional(),
});

const updateSchema = z.object({
  password: passwordSchema.optional(),
  groups: z.array(nameSchema).max(64).optional(),
  sambaEnabled: z.boolean().optional(),
});

const deleteQuerySchema = z.object({
  deleteHome: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "true"),
});

// GET /api/users
usersRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await listUsers());
  }),
);

// POST /api/users
usersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const user = await createUser(body);
    res.status(201).json(user);
  }),
);

// PUT /api/users/:name
usersRouter.put(
  "/:name",
  asyncHandler(async (req, res) => {
    const name = nameSchema.parse(req.params.name);
    await assertHumanUser(name);
    const body = updateSchema.parse(req.body);
    const user = await updateUser(name, body);
    res.status(200).json(user);
  }),
);

// DELETE /api/users/:name?deleteHome=bool
usersRouter.delete(
  "/:name",
  asyncHandler(async (req, res) => {
    const name = nameSchema.parse(req.params.name);
    await assertHumanUser(name);
    const { deleteHome } = deleteQuerySchema.parse(req.query);
    await deleteUser(name, deleteHome);
    res.status(204).end();
  }),
);

// Groups live under the same domain; mounted separately as /api/groups in index.
export const groupsRouter = Router();
groupsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await listGroups());
  }),
);
