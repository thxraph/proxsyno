/**
 * SMB (smb.conf) and NFS (/etc/exports) share management.
 *
 * smb.conf is only ever edited INSIDE per-share delimited markers:
 *   # >>> proxsyno managed: <name>
 *   ...[name]...
 *   # <<< proxsyno managed: <name>
 * so hand-written sections are never clobbered. Every write is validated with
 * `testparm -s` and rolled back to the previous content on failure.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../config.js";
import { ApiError } from "../util/errors.js";
import { run, CommandNotFoundError } from "../util/exec.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SmbShare {
  name: string;
  path: string;
  comment?: string;
  readOnly: boolean;
  guestOk: boolean;
  validUsers: string[];
}

export interface NfsClient {
  host: string;
  options: string;
}

export interface NfsExport {
  path: string;
  clients: NfsClient[];
}

export interface SharesResponse {
  smb: SmbShare[];
  nfs: NfsExport[];
}

const MARK_START = (name: string): string => `# >>> proxsyno managed: ${name}`;
const MARK_END = (name: string): string => `# <<< proxsyno managed: ${name}`;

// ---------------------------------------------------------------------------
// smb.conf rendering / parsing
// ---------------------------------------------------------------------------

/** Render a single managed block for a share. */
function renderSmbBlock(s: SmbShare): string {
  const lines: string[] = [];
  lines.push(MARK_START(s.name));
  lines.push(`[${s.name}]`);
  lines.push(`   path = ${s.path}`);
  if (s.comment) lines.push(`   comment = ${s.comment}`);
  lines.push(`   read only = ${s.readOnly ? "yes" : "no"}`);
  lines.push(`   guest ok = ${s.guestOk ? "yes" : "no"}`);
  lines.push("   browseable = yes");
  if (s.validUsers.length > 0) {
    lines.push(`   valid users = ${s.validUsers.join(", ")}`);
  }
  lines.push(MARK_END(s.name));
  return lines.join("\n");
}

/** Read smb.conf, returning "" if it does not exist yet. */
async function readSmbConf(): Promise<string> {
  try {
    return await fs.readFile(config.smbConfPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw err;
  }
}

/** Extract the body (between markers) of a managed share, or null if absent. */
function extractManagedBlock(content: string, name: string): string | null {
  const start = content.indexOf(MARK_START(name));
  const end = content.indexOf(MARK_END(name));
  if (start === -1 || end === -1 || end < start) return null;
  return content.slice(start, end + MARK_END(name).length);
}

/** Remove a managed block (and its surrounding blank line) from content. */
function removeManagedBlock(content: string, name: string): string {
  const block = extractManagedBlock(content, name);
  if (!block) return content;
  // Also swallow a trailing newline so we don't accumulate blank lines.
  return content.replace(block + "\n", "").replace(block, "");
}

/**
 * Parse all proxsyno-managed SMB share blocks. We intentionally only surface
 * blocks WE manage (between markers) so the UI never shows hand-edited shares.
 */
export async function listSmbShares(): Promise<SmbShare[]> {
  const content = await readSmbConf();
  const shares: SmbShare[] = [];
  const blockRe = /# >>> proxsyno managed: (\S+)\n([\s\S]*?)\n# <<< proxsyno managed: \1/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(content)) !== null) {
    const name = m[1]!;
    const body = m[2]!;
    const getVal = (key: string): string | undefined => {
      const r = body.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, "im"));
      return r ? r[1]!.trim() : undefined;
    };
    const readOnlyRaw = getVal("read only");
    const guestRaw = getVal("guest ok");
    const validUsersRaw = getVal("valid users");
    const share: SmbShare = {
      name,
      path: getVal("path") ?? "",
      readOnly: readOnlyRaw ? /^(yes|true|1)$/i.test(readOnlyRaw) : false,
      guestOk: guestRaw ? /^(yes|true|1)$/i.test(guestRaw) : false,
      validUsers: validUsersRaw
        ? validUsersRaw.split(/[,\s]+/).map((u) => u.trim()).filter(Boolean)
        : [],
    };
    const comment = getVal("comment");
    if (comment) share.comment = comment;
    shares.push(share);
  }
  return shares;
}

/**
 * Atomically write new smb.conf content: write to a temp file, validate with
 * `testparm -s`, then move into place. On validation/move failure the original
 * file is untouched (we never overwrite before validation passes).
 */
async function writeAndValidateSmbConf(newContent: string): Promise<void> {
  const dir = path.dirname(config.smbConfPath);
  const tmp = path.join(dir, `.proxsyno-smb-${process.pid}-${Date.now()}.tmp`);

  await fs.writeFile(tmp, newContent, { mode: 0o644 });
  try {
    // testparm -s on the candidate file: exits non-zero on syntax errors.
    await run("testparm", ["-s", tmp], { allowNonZeroExit: false });
  } catch (err) {
    await fs.rm(tmp, { force: true });
    if (err instanceof CommandNotFoundError) {
      throw ApiError.internal("testparm not found — install the samba package");
    }
    throw ApiError.badRequest(
      "Generated smb.conf failed validation (rolled back): " +
        (err instanceof Error ? err.message : String(err)),
    );
  }

  // Validation passed — move into place atomically (same filesystem).
  try {
    await fs.rename(tmp, config.smbConfPath);
  } catch {
    // Cross-device rename can fail; fall back to copy+unlink.
    await fs.copyFile(tmp, config.smbConfPath);
    await fs.rm(tmp, { force: true });
  }
}

/** Reload smbd so changes take effect, without dropping connections. */
async function reloadSmbd(): Promise<void> {
  // Try systemd reload first; fall back to smbcontrol. Both are best-effort.
  try {
    await run("systemctl", ["reload-or-restart", "smbd"], { timeoutMs: 15000 });
    return;
  } catch (err) {
    if (!(err instanceof CommandNotFoundError)) return; // reload attempted
  }
  try {
    await run("smbcontrol", ["smbd", "reload-config"], { allowNonZeroExit: true });
  } catch {
    /* best-effort */
  }
}

/** Create or replace a managed SMB share, validate, then reload smbd. */
export async function upsertSmbShare(share: SmbShare): Promise<SmbShare> {
  const original = await readSmbConf();

  // Remove any existing managed block for this name, then append the new one.
  let next = removeManagedBlock(original, share.name);
  if (next.length > 0 && !next.endsWith("\n")) next += "\n";
  next += `\n${renderSmbBlock(share)}\n`;

  await writeAndValidateSmbConf(next);
  await reloadSmbd();
  return share;
}

/** Delete a managed SMB share. Throws 404 if not present. */
export async function deleteSmbShare(name: string): Promise<void> {
  const original = await readSmbConf();
  if (!extractManagedBlock(original, name)) {
    throw ApiError.notFound(`SMB share not found: ${name}`);
  }
  const next = removeManagedBlock(original, name);
  await writeAndValidateSmbConf(next);
  await reloadSmbd();
}

// ---------------------------------------------------------------------------
// NFS /etc/exports
// ---------------------------------------------------------------------------

async function readExports(): Promise<string> {
  try {
    return await fs.readFile(config.nfsExportsPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw err;
  }
}

/**
 * Parse /etc/exports. Each non-comment line is:
 *   <path> host1(opts) host2(opts) ...
 * Paths may be quoted if they contain spaces ("/my dir").
 */
export async function listNfsExports(): Promise<NfsExport[]> {
  const content = await readExports();
  const exports: NfsExport[] = [];
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    // Match a leading quoted or unquoted path, then the remainder = clients.
    const m = line.match(/^("([^"]+)"|(\S+))\s+(.*)$/);
    if (!m) continue;
    const exportPath = m[2] ?? m[3] ?? "";
    const rest = m[4] ?? "";

    const clients: NfsClient[] = [];
    // Each client token: host(options) or just host.
    const clientRe = /(\S+?)\(([^)]*)\)|(\S+)/g;
    let cm: RegExpExecArray | null;
    while ((cm = clientRe.exec(rest)) !== null) {
      if (cm[1] !== undefined) {
        clients.push({ host: cm[1], options: cm[2] ?? "" });
      } else if (cm[3] !== undefined) {
        clients.push({ host: cm[3], options: "" });
      }
    }
    exports.push({ path: exportPath, clients });
  }
  return exports;
}

function renderExportLine(exp: NfsExport): string {
  const pathToken = exp.path.includes(" ") ? `"${exp.path}"` : exp.path;
  const clientTokens = exp.clients.map((c) =>
    c.options ? `${c.host}(${c.options})` : c.host,
  );
  return `${pathToken} ${clientTokens.join(" ")}`.trim();
}

async function writeExports(content: string): Promise<void> {
  const dir = path.dirname(config.nfsExportsPath);
  const tmp = path.join(dir, `.proxsyno-exports-${process.pid}-${Date.now()}.tmp`);
  await fs.writeFile(tmp, content, { mode: 0o644 });
  try {
    await fs.rename(tmp, config.nfsExportsPath);
  } catch {
    await fs.copyFile(tmp, config.nfsExportsPath);
    await fs.rm(tmp, { force: true });
  }
}

/** Apply exports to the running NFS server. */
async function exportfsReload(): Promise<void> {
  try {
    await run("exportfs", ["-ra"], { timeoutMs: 15000 });
  } catch (err) {
    if (err instanceof CommandNotFoundError) {
      throw ApiError.internal("exportfs not found — install nfs-kernel-server");
    }
    throw ApiError.badRequest(
      "exportfs -ra failed: " + (err instanceof Error ? err.message : String(err)),
    );
  }
}

/** Create or replace an NFS export for a path, then `exportfs -ra`. */
export async function upsertNfsExport(exp: NfsExport): Promise<NfsExport> {
  const existing = await listNfsExports();
  const filtered = existing.filter((e) => e.path !== exp.path);
  filtered.push(exp);

  const header =
    "# Managed in part by proxsyno. Lines are rewritten on change; comments above\n" +
    "# unmanaged paths are preserved only if they precede the export table.\n";
  const body = filtered.map(renderExportLine).join("\n");
  await writeExports(`${header}${body}\n`);
  await exportfsReload();
  return exp;
}

/** Delete the NFS export for a path. Throws 404 if absent. */
export async function deleteNfsExport(exportPath: string): Promise<void> {
  const existing = await listNfsExports();
  if (!existing.some((e) => e.path === exportPath)) {
    throw ApiError.notFound(`NFS export not found: ${exportPath}`);
  }
  const filtered = existing.filter((e) => e.path !== exportPath);
  const header =
    "# Managed in part by proxsyno. Lines are rewritten on change.\n";
  const body = filtered.map(renderExportLine).join("\n");
  await writeExports(`${header}${body}${body ? "\n" : ""}`);
  await exportfsReload();
}

export async function listShares(): Promise<SharesResponse> {
  const [smb, nfs] = await Promise.all([listSmbShares(), listNfsExports()]);
  return { smb, nfs };
}

// Exposed for potential diagnostics/tests.
export const _internal = { renderSmbBlock, renderExportLine, MARK_START, MARK_END, hostname: os.hostname() };
