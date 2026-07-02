import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
// renderSmbBlock and hasUnmanagedSection are pure; safe to import statically.
import { renderSmbBlock, hasUnmanagedSection } from "../services/samba.js";
import type { SmbShare } from "../services/samba.js";

describe("renderSmbBlock", () => {
  it("renders a full managed block with markers, path, flags and valid users", () => {
    const share: SmbShare = {
      name: "media",
      path: "/mnt/media",
      comment: "Media",
      readOnly: false,
      guestOk: true,
      validUsers: ["alice", "bob"],
      managed: true,
    };
    const out = renderSmbBlock(share);
    expect(out).toContain("# >>> proxsyno managed: media");
    expect(out).toContain("[media]");
    expect(out).toContain("path = /mnt/media");
    expect(out).toContain("read only = no");
    expect(out).toContain("guest ok = yes");
    expect(out).toContain("valid users = alice, bob");
    expect(out).toContain("# <<< proxsyno managed: media");
  });

  it("omits the 'valid users' line when validUsers is empty", () => {
    const share: SmbShare = {
      name: "public",
      path: "/mnt/public",
      readOnly: true,
      guestOk: false,
      validUsers: [],
      managed: true,
    };
    const out = renderSmbBlock(share);
    expect(out).toContain("[public]");
    expect(out).not.toContain("valid users");
  });
});

describe("hasUnmanagedSection", () => {
  it("returns true for a plain [raid] section with no markers", () => {
    const content = ["[raid]", "   path = /mnt/raid", ""].join("\n");
    expect(hasUnmanagedSection(content, "raid")).toBe(true);
  });

  it("returns false when the [media] section sits inside proxsyno markers", () => {
    const content = renderSmbBlock({
      name: "media",
      path: "/mnt/media",
      readOnly: false,
      guestOk: false,
      validUsers: [],
      managed: true,
    });
    expect(hasUnmanagedSection(content, "media")).toBe(false);
  });

  it("returns false when the section name is not present", () => {
    const content = ["[raid]", "   path = /mnt/raid"].join("\n");
    expect(hasUnmanagedSection(content, "nope")).toBe(false);
  });
});

// listSmbShares reads config.smbConfPath, which is frozen from SMB_CONF at the
// moment config.js is first evaluated. We must set SMB_CONF and vi.resetModules()
// so a fresh dynamic import re-reads the env against our fixture.
async function importSambaWith(smbConf: string): Promise<typeof import("../services/samba.js")> {
  process.env.SMB_CONF = smbConf;
  vi.resetModules();
  return import("../services/samba.js");
}

describe("listSmbShares (via SMB_CONF fixture)", () => {
  let dir: string;
  let tmpFile: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "proxsyno-smb-"));
    tmpFile = path.join(dir, "smb.conf");

    const managedMedia = renderSmbBlock({
      name: "media",
      path: "/mnt/media",
      comment: "Media library",
      readOnly: false,
      guestOk: true,
      validUsers: [],
      managed: true,
    });

    const content = [
      "[global]",
      "   workgroup = WORKGROUP",
      "",
      "[homes]",
      "   browseable = no",
      "",
      "[printers]",
      "   path = /var/spool/samba",
      "",
      "[raid]",
      "   path = /mnt/raid",
      "   comment = RAID array",
      "   valid users = alice",
      "   read only = no",
      "",
      managedMedia,
      "",
    ].join("\n");

    await fs.writeFile(tmpFile, content, "utf8");
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    delete process.env.SMB_CONF;
    vi.resetModules();
  });

  it("returns only the non-special shares (raid + media), not global/homes/printers", async () => {
    const { listSmbShares } = await importSambaWith(tmpFile);
    const shares = await listSmbShares();
    const names = shares.map((s) => s.name).sort();
    expect(names).toEqual(["media", "raid"]);
  });

  it("flags managed vs unmanaged and parses fields correctly", async () => {
    const { listSmbShares } = await importSambaWith(tmpFile);
    const shares = await listSmbShares();
    const raid = shares.find((s) => s.name === "raid")!;
    const media = shares.find((s) => s.name === "media")!;

    expect(raid.managed).toBe(false);
    expect(media.managed).toBe(true);
    expect(raid.path).toBe("/mnt/raid");
    expect(raid.validUsers).toEqual(["alice"]);
  });

  it("treats 'writable = yes' as the inverse of read only (readOnly === false)", async () => {
    const wdir = await fs.mkdtemp(path.join(os.tmpdir(), "proxsyno-smb-w-"));
    const wfile = path.join(wdir, "smb.conf");
    await fs.writeFile(
      wfile,
      ["[scratch]", "   path = /mnt/scratch", "   writable = yes", ""].join("\n"),
      "utf8",
    );
    try {
      const { listSmbShares } = await importSambaWith(wfile);
      const shares = await listSmbShares();
      const scratch = shares.find((s) => s.name === "scratch")!;
      expect(scratch).toBeDefined();
      expect(scratch.readOnly).toBe(false);
    } finally {
      await fs.rm(wdir, { recursive: true, force: true });
    }
  });
});
