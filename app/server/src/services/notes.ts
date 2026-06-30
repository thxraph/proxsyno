/**
 * Note Station persistence — a markdown notes store backed by a single atomic
 * JSON file (no external DB). Notes carry a server-generated UUID, so nothing
 * the client supplies is ever used to build a filesystem path.
 *
 * The data directory defaults to /var/lib/proxsyno/notes (override with
 * NOTES_DIR). All mutations are serialised through a tiny promise-chain lock and
 * persisted with a write-tmp-then-rename so a crash never leaves a half-written
 * db.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ApiError } from "../util/errors.js";

const NOTES_DIR = path.resolve(
  process.env.NOTES_DIR && process.env.NOTES_DIR !== ""
    ? process.env.NOTES_DIR
    : "/var/lib/proxsyno/notes",
);
const DB_PATH = path.join(NOTES_DIR, "notes.json");
const DEFAULT_NOTEBOOK = "My Notebook";

export interface Note {
  id: string;
  title: string;
  notebook: string;
  tags: string[];
  body: string;
  createdAt: number;
  updatedAt: number;
}

/** List/tree projection — everything except the (potentially large) body. */
export type NoteSummary = Omit<Note, "body">;

interface Db {
  notes: Note[];
}

// ---------------------------------------------------------------------------
// Persistence (atomic, serialised)
// ---------------------------------------------------------------------------

async function readDb(): Promise<Db> {
  try {
    const raw = await readFile(DB_PATH, "utf8");
    const parsed = JSON.parse(raw) as Db;
    if (!parsed || !Array.isArray(parsed.notes)) return { notes: [] };
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { notes: [] };
    throw err;
  }
}

async function writeDb(db: Db): Promise<void> {
  await mkdir(NOTES_DIR, { recursive: true });
  const tmp = `${DB_PATH}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  await rename(tmp, DB_PATH);
}

// Serialise read-modify-write cycles so concurrent requests can't clobber each
// other. Reads that don't mutate go straight to readDb (rename is atomic).
let lock: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = lock.then(fn, fn);
  lock = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function toSummary(n: Note): NoteSummary {
  const { body: _body, ...rest } = n;
  void _body;
  return rest;
}

function byUpdatedDesc(a: NoteSummary, b: NoteSummary): number {
  return b.updatedAt - a.updatedAt;
}

/** All notes as summaries, newest first. Optional case-insensitive search over
 *  title + body. */
export async function listNotes(query?: string): Promise<NoteSummary[]> {
  const { notes } = await readDb();
  const q = query?.trim().toLowerCase();
  const matched = q
    ? notes.filter(
        (n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q),
      )
    : notes;
  return matched.map(toSummary).sort(byUpdatedDesc);
}

/** Distinct notebook names, alphabetical. */
export async function listNotebooks(): Promise<string[]> {
  const { notes } = await readDb();
  return [...new Set(notes.map((n) => n.notebook))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export async function getNote(id: string): Promise<Note> {
  const { notes } = await readDb();
  const note = notes.find((n) => n.id === id);
  if (!note) throw ApiError.notFound(`Note not found: ${id}`);
  return note;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface CreateNoteInput {
  title: string;
  notebook?: string;
  body?: string;
  tags?: string[];
}

export async function createNote(input: CreateNoteInput): Promise<Note> {
  return withLock(async () => {
    const db = await readDb();
    const now = Date.now();
    const note: Note = {
      id: randomUUID(),
      title: input.title,
      notebook: input.notebook?.trim() || DEFAULT_NOTEBOOK,
      tags: input.tags ?? [],
      body: input.body ?? "",
      createdAt: now,
      updatedAt: now,
    };
    db.notes.push(note);
    await writeDb(db);
    return note;
  });
}

export interface UpdateNoteInput {
  title?: string;
  notebook?: string;
  body?: string;
  tags?: string[];
}

export async function updateNote(id: string, input: UpdateNoteInput): Promise<Note> {
  return withLock(async () => {
    const db = await readDb();
    const note = db.notes.find((n) => n.id === id);
    if (!note) throw ApiError.notFound(`Note not found: ${id}`);
    if (input.title !== undefined) note.title = input.title;
    if (input.notebook !== undefined) note.notebook = input.notebook.trim() || DEFAULT_NOTEBOOK;
    if (input.body !== undefined) note.body = input.body;
    if (input.tags !== undefined) note.tags = input.tags;
    note.updatedAt = Date.now();
    await writeDb(db);
    return note;
  });
}

export async function deleteNote(id: string): Promise<void> {
  return withLock(async () => {
    const db = await readDb();
    const next = db.notes.filter((n) => n.id !== id);
    if (next.length === db.notes.length) {
      throw ApiError.notFound(`Note not found: ${id}`);
    }
    db.notes = next;
    await writeDb(db);
  });
}
