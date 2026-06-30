/**
 * Note Station routes. Mounted at /api/notes (auth-guarded with every other
 * domain in index.ts). Notebook/title/tag values are stored only inside the
 * JSON db — never in a shell or a filesystem path — so they take a permissive
 * "no control characters" schema rather than the strict NAME_REGEX.
 */
import { Router } from "express";
import { z } from "zod";
import {
  createNote,
  deleteNote,
  getNote,
  listNotebooks,
  listNotes,
  updateNote,
} from "../services/notes.js";
import { asyncHandler } from "../util/errors.js";

export const notesRouter = Router();

const NO_CTRL = /^[^\0\n\r]*$/;

const titleSchema = z.string().trim().min(1).max(200).regex(NO_CTRL, "no control characters");
const notebookSchema = z.string().trim().min(1).max(100).regex(NO_CTRL, "no control characters");
const bodySchema = z.string().max(200_000);
const tagsSchema = z
  .array(z.string().trim().min(1).max(50).regex(NO_CTRL, "no control characters"))
  .max(64);
const idSchema = z.string().uuid();

const createSchema = z.object({
  title: titleSchema,
  notebook: notebookSchema.optional(),
  body: bodySchema.optional(),
  tags: tagsSchema.optional(),
});

const updateSchema = z
  .object({
    title: titleSchema.optional(),
    notebook: notebookSchema.optional(),
    body: bodySchema.optional(),
    tags: tagsSchema.optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "no fields to update" });

const listQuerySchema = z.object({ q: z.string().max(200).optional() });

// GET /api/notes?q=  → { notebooks, notes } (notes are body-less summaries)
notesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { q } = listQuerySchema.parse(req.query);
    const [notebooks, notes] = await Promise.all([listNotebooks(), listNotes(q)]);
    res.json({ notebooks, notes });
  }),
);

// GET /api/notes/:id  → full note (with body)
notesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    res.json(await getNote(id));
  }),
);

// POST /api/notes
notesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    res.status(201).json(await createNote(body));
  }),
);

// PUT /api/notes/:id
notesRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const body = updateSchema.parse(req.body);
    res.json(await updateNote(id, body));
  }),
);

// DELETE /api/notes/:id
notesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    await deleteNote(id);
    res.status(204).end();
  }),
);
