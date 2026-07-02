import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

// fsbrowse resolves against config.filesRoot, frozen from FILES_ROOT when
// config.js is first evaluated. Set FILES_ROOT + vi.resetModules() BEFORE the
// dynamic import so the jail root points at our fresh temp dir.
let root: string;
let fsb: typeof import("../services/fsbrowse.js");

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "proxsyno-jail-"));
  // A real dir inside the jail for the "inside resolves OK" case.
  await fs.mkdir(path.join(root, "inside"), { recursive: true });
  // A symlink inside the jail that points OUT of it (to /etc).
  await fs.symlink("/etc", path.join(root, "escape-link"));

  process.env.FILES_ROOT = root;
  vi.resetModules();
  fsb = await import("../services/fsbrowse.js");
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
  delete process.env.FILES_ROOT;
  vi.resetModules();
});

describe("resolveInsideJail (no filesystem touch)", () => {
  it("resolves a relative path inside the jail to a path within root", () => {
    const resolved = fsb.resolveInsideJail("inside");
    expect(resolved.startsWith(root)).toBe(true);
    expect(resolved).toBe(path.join(root, "inside"));
  });

  it("rejects a `..` traversal escaping the root", () => {
    expect(() => fsb.resolveInsideJail("../../../etc/passwd")).toThrow();
  });

  it("rejects an absolute path outside the root", () => {
    expect(() => fsb.resolveInsideJail("/etc/passwd")).toThrow();
  });
});

describe("resolveExistingInsideJail (realpath / symlink check)", () => {
  it("resolves an existing path inside the jail", async () => {
    const resolved = await fsb.resolveExistingInsideJail("inside");
    expect(resolved.startsWith(root)).toBe(true);
  });

  it("rejects a `..` traversal escaping the root", async () => {
    await expect(fsb.resolveExistingInsideJail("../../etc")).rejects.toThrow();
  });

  it("rejects an absolute path outside the root", async () => {
    await expect(fsb.resolveExistingInsideJail("/etc/passwd")).rejects.toThrow();
  });

  it("rejects a symlink inside the jail that points outside (symlink escape)", async () => {
    await expect(fsb.resolveExistingInsideJail("escape-link")).rejects.toThrow();
  });
});
