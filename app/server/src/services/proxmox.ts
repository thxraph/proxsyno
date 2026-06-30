/**
 * Proxmox virtualization integration: VM/LXC inventory + lifecycle, create
 * forms, and the community-scripts catalog.
 *
 * Every OS interaction goes through the args-array exec wrapper (util/exec.ts) —
 * no shell strings are ever built from user input. The ONE place a shell runs is
 * the community-script PTY command spawned by the console WebSocket, and its only
 * variable is a slug that has been validated against both a strict regex and the
 * cached catalog (see SCRIPT_SLUG_REGEX / isScriptInCatalog / spawnConsolePty).
 *
 * Each helper degrades gracefully: when a Proxmox binary is missing (non-PVE
 * host) we report `isProxmox:false` / return empty rather than 500-ing.
 */
import os from "node:os";
import { createRequire } from "node:module";
import { run, CommandNotFoundError } from "../util/exec.js";
import { ApiError } from "../util/errors.js";

// ---------------------------------------------------------------------------
// Types (mirror SPEC addendum)
// ---------------------------------------------------------------------------

export type GuestType = "qemu" | "lxc";
export type GuestStatus = "running" | "stopped" | "paused" | "unknown";
export type GuestAction = "start" | "stop" | "shutdown" | "reboot";

export interface Guest {
  vmid: number;
  type: GuestType;
  name: string;
  status: GuestStatus;
  node: string;
  cpu: number; // 0..1
  maxcpu: number;
  mem: number;
  maxmem: number;
  disk: number;
  maxdisk: number;
  uptimeSec: number;
  template: boolean;
}

export interface StorageOption {
  name: string;
  type: string;
  content: string[];
  availBytes: number;
  totalBytes: number;
}

export interface IsoOption {
  volid: string;
  storage: string;
  sizeBytes: number;
}

export interface TemplateOption {
  volid: string;
  storage: string;
  name: string;
}

export interface BridgeOption {
  name: string;
}

export interface ProxmoxOptions {
  node: string;
  nextId: number;
  storages: StorageOption[];
  isos: IsoOption[];
  templates: TemplateOption[];
  bridges: BridgeOption[];
  osTypes: string[];
}

export interface ScriptMeta {
  slug: string;
  name: string;
  description?: string;
  category?: string;
  source: string; // "ct/<slug>.sh"
  url: string;
}

export interface CreateVmInput {
  name: string;
  cores: number;
  memoryMB: number;
  diskGB: number;
  storage: string;
  isoVolid?: string;
  bridge: string;
  ostype?: string;
}

export interface CreateLxcInput {
  hostname: string;
  templateVolid: string;
  cores: number;
  memoryMB: number;
  diskGB: number;
  storage: string;
  bridge: string;
  password: string;
  unprivileged: boolean;
  startOnCreate: boolean;
}

/** qm `--ostype` accepted values. Used to validate the VM create form. */
export const OS_TYPES = [
  "other",
  "wxp",
  "w2k",
  "w2k3",
  "w2k8",
  "wvista",
  "win7",
  "win8",
  "win10",
  "win11",
  "l24",
  "l26",
  "solaris",
] as const;

// ---------------------------------------------------------------------------
// Availability + node name
// ---------------------------------------------------------------------------

export interface Availability {
  isProxmox: boolean;
  node: string;
  pveVersion?: string;
}

/** Proxmox node name. PVE uses the (short) hostname as the node id. */
async function getNodeName(): Promise<string> {
  try {
    const { stdout } = await run("hostname", [], { timeoutMs: 5000 });
    const first = stdout.trim().split("\n")[0]?.trim();
    return first || os.hostname();
  } catch {
    return os.hostname();
  }
}

/** `{ isProxmox, node, pveVersion? }` — detected via `pveversion` + `hostname`. */
export async function getAvailable(): Promise<Availability> {
  const node = await getNodeName();
  try {
    const { stdout } = await run("pveversion", [], { timeoutMs: 5000 });
    const line = stdout.trim().split("\n")[0] ?? "";
    // e.g. "pve-manager/8.2.2/9355359cdf9b6909 (running kernel: 6.8.4-2-pve)"
    const m = line.match(/pve-manager\/([^\s/]+)/);
    const pveVersion = m ? m[1] : line || undefined;
    return pveVersion ? { isProxmox: true, node, pveVersion } : { isProxmox: true, node };
  } catch (err) {
    if (err instanceof CommandNotFoundError) return { isProxmox: false, node };
    // pveversion exists but errored — treat as not-usable for the UI.
    return { isProxmox: false, node };
  }
}

// ---------------------------------------------------------------------------
// Guests
// ---------------------------------------------------------------------------

interface ClusterResource {
  id?: string;
  type?: string; // "qemu" | "lxc" | "storage" | "node" | ...
  vmid?: number;
  name?: string;
  status?: string;
  node?: string;
  cpu?: number;
  maxcpu?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  uptime?: number;
  template?: number | boolean;
}

function normaliseStatus(s: string | undefined): GuestStatus {
  switch (s) {
    case "running":
    case "stopped":
    case "paused":
      return s;
    default:
      return "unknown";
  }
}

function mapResourceToGuest(r: ClusterResource): Guest {
  const type: GuestType = r.type === "lxc" ? "lxc" : "qemu";
  return {
    vmid: typeof r.vmid === "number" ? r.vmid : Number.parseInt(String(r.vmid ?? 0), 10) || 0,
    type,
    name: r.name ?? "",
    status: normaliseStatus(r.status),
    node: r.node ?? "",
    cpu: typeof r.cpu === "number" ? r.cpu : 0,
    maxcpu: typeof r.maxcpu === "number" ? r.maxcpu : 0,
    mem: typeof r.mem === "number" ? r.mem : 0,
    maxmem: typeof r.maxmem === "number" ? r.maxmem : 0,
    disk: typeof r.disk === "number" ? r.disk : 0,
    maxdisk: typeof r.maxdisk === "number" ? r.maxdisk : 0,
    uptimeSec: typeof r.uptime === "number" ? r.uptime : 0,
    template: r.template === 1 || r.template === true,
  };
}

/** All VM + LXC guests from `pvesh get /cluster/resources --type vm`. */
export async function listGuests(): Promise<Guest[]> {
  try {
    const { stdout } = await run("pvesh", [
      "get",
      "/cluster/resources",
      "--type",
      "vm",
      "--output-format",
      "json",
    ]);
    const parsed = JSON.parse(stdout) as ClusterResource[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r) => r.type === "qemu" || r.type === "lxc")
      .map(mapResourceToGuest)
      .sort((a, b) => a.vmid - b.vmid);
  } catch (err) {
    if (err instanceof CommandNotFoundError) return [];
    throw err;
  }
}

/** Run a lifecycle action via `qm`/`pct`. vmid + action are pre-validated. */
export async function guestAction(type: GuestType, vmid: number, action: GuestAction): Promise<void> {
  const bin = type === "lxc" ? "pct" : "qm";
  try {
    // shutdown can block on the guest; give it generous headroom.
    await run(bin, [action, String(vmid)], { timeoutMs: 120_000 });
  } catch (err) {
    if (err instanceof CommandNotFoundError) {
      throw ApiError.internal(`${bin} is not available on this host`);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Create-form options
// ---------------------------------------------------------------------------

interface StorageCfg {
  storage?: string;
  type?: string;
  content?: string;
}

/** Map of storage name -> { type, content[] } from `pvesh get /storage`. */
async function readStorageConfig(): Promise<Map<string, { type: string; content: string[] }>> {
  const map = new Map<string, { type: string; content: string[] }>();
  try {
    const { stdout } = await run("pvesh", ["get", "/storage", "--output-format", "json"]);
    const parsed = JSON.parse(stdout) as StorageCfg[];
    for (const s of parsed) {
      if (!s.storage) continue;
      const content = (s.content ?? "")
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      map.set(s.storage, { type: s.type ?? "", content });
    }
  } catch {
    /* config unavailable — content stays empty, numbers still come from pvesm */
  }
  return map;
}

/**
 * Parse `pvesm status` for the per-storage usage table.
 * Columns: Name Type Status Total Used Available %.
 * NOTE: `pvesm status` reports sizes in KiB, so we scale to bytes here.
 */
async function readStorages(): Promise<StorageOption[]> {
  const cfg = await readStorageConfig();
  const out: StorageOption[] = [];
  try {
    const { stdout } = await run("pvesm", ["status"]);
    for (const line of stdout.split("\n")) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 6) continue;
      if (cols[0] === "Name") continue; // header
      const name = cols[0]!;
      const type = cols[1] ?? "";
      const totalKb = Number.parseInt(cols[3] ?? "0", 10) || 0;
      const availKb = Number.parseInt(cols[5] ?? "0", 10) || 0;
      const conf = cfg.get(name);
      out.push({
        name,
        type: conf?.type || type,
        content: conf?.content ?? [],
        totalBytes: totalKb * 1024,
        availBytes: availKb * 1024,
      });
    }
  } catch (err) {
    if (err instanceof CommandNotFoundError) return [];
    throw err;
  }
  return out;
}

interface PvesmVolume {
  volid?: string;
  size?: number;
}

/** ISO images on a storage via `pvesm list <storage> --content iso`. */
async function readIsos(storages: StorageOption[]): Promise<IsoOption[]> {
  const out: IsoOption[] = [];
  for (const s of storages) {
    if (!s.content.includes("iso")) continue;
    try {
      const { stdout } = await run("pvesm", ["list", s.name, "--content", "iso", "--output-format", "json"]);
      const vols = JSON.parse(stdout) as PvesmVolume[];
      for (const v of vols) {
        if (!v.volid) continue;
        out.push({ volid: v.volid, storage: s.name, sizeBytes: typeof v.size === "number" ? v.size : 0 });
      }
    } catch {
      /* skip storages that fail to list */
    }
  }
  return out;
}

/** Downloaded LXC templates per storage via `pveam list <storage>`. */
async function readTemplates(storages: StorageOption[]): Promise<TemplateOption[]> {
  const out: TemplateOption[] = [];
  for (const s of storages) {
    if (!s.content.includes("vztmpl")) continue;
    try {
      // pveam list emits a plain text table: "<volid>    <size>"; header is NAME/SIZE.
      const { stdout } = await run("pveam", ["list", s.name]);
      for (const line of stdout.split("\n")) {
        const volid = line.trim().split(/\s+/)[0];
        if (!volid || volid === "NAME" || !volid.includes(":")) continue;
        const base = volid.split("/").pop() ?? volid;
        out.push({ volid, storage: s.name, name: base });
      }
    } catch {
      /* skip storages that fail to list */
    }
  }
  return out;
}

interface IpLink {
  ifname?: string;
}

/** Linux bridges named vmbrN from `ip -j link`. */
async function readBridges(): Promise<BridgeOption[]> {
  try {
    const { stdout } = await run("ip", ["-j", "link"]);
    const links = JSON.parse(stdout) as IpLink[];
    return links
      .map((l) => l.ifname ?? "")
      .filter((n) => /^vmbr\d+$/.test(n))
      .sort()
      .map((name) => ({ name }));
  } catch (err) {
    if (err instanceof CommandNotFoundError) return [];
    throw err;
  }
}

/** The next free VM/CT id via `pvesh get /cluster/nextid`. */
async function readNextId(): Promise<number> {
  try {
    const { stdout } = await run("pvesh", ["get", "/cluster/nextid"]);
    // Scalar output may be a bare number or a JSON-quoted string.
    const n = Number.parseInt(stdout.trim().replace(/^"|"$/g, ""), 10);
    if (!Number.isFinite(n)) throw new Error(`unexpected nextid output: ${stdout}`);
    return n;
  } catch (err) {
    if (err instanceof CommandNotFoundError) throw ApiError.internal("pvesh is not available on this host");
    throw err;
  }
}

export async function getOptions(): Promise<ProxmoxOptions> {
  const node = await getNodeName();
  const storages = await readStorages();
  const [nextId, isos, templates, bridges] = await Promise.all([
    readNextId(),
    readIsos(storages),
    readTemplates(storages),
    readBridges(),
  ]);
  return { node, nextId, storages, isos, templates, bridges, osTypes: [...OS_TYPES] };
}

// ---------------------------------------------------------------------------
// Create VM / LXC
// ---------------------------------------------------------------------------

export async function createVm(input: CreateVmInput): Promise<number> {
  const vmid = await readNextId();
  const args: string[] = [
    "create",
    String(vmid),
    "--name",
    input.name,
    "--cores",
    String(input.cores),
    "--memory",
    String(input.memoryMB),
    "--net0",
    `virtio,bridge=${input.bridge}`,
    "--scsihw",
    "virtio-scsi-pci",
    "--scsi0",
    `${input.storage}:${input.diskGB}`,
  ];
  if (input.isoVolid) {
    args.push("--ide2", `${input.isoVolid},media=cdrom`);
  }
  if (input.ostype) {
    args.push("--ostype", input.ostype);
  }
  args.push("--boot", input.isoVolid ? "order=scsi0;ide2" : "order=scsi0");

  try {
    await run("qm", args, { timeoutMs: 120_000 });
  } catch (err) {
    if (err instanceof CommandNotFoundError) throw ApiError.internal("qm is not available on this host");
    throw err;
  }
  return vmid;
}

export async function createLxc(input: CreateLxcInput): Promise<number> {
  const vmid = await readNextId();
  const args: string[] = [
    "create",
    String(vmid),
    input.templateVolid,
    "--hostname",
    input.hostname,
    "--cores",
    String(input.cores),
    "--memory",
    String(input.memoryMB),
    "--rootfs",
    `${input.storage}:${input.diskGB}`,
    "--net0",
    `name=eth0,bridge=${input.bridge},ip=dhcp`,
    // TODO(security): the root password is passed on argv and is therefore
    // visible to root via /proc/<pid>/cmdline. Acceptable for the MVP; switch to
    // a no-leak channel (e.g. pct create reading a temp file / stdin) later.
    "--password",
    input.password,
  ];
  if (input.unprivileged) {
    args.push("--unprivileged", "1");
  }

  try {
    await run("pct", args, { timeoutMs: 120_000 });
  } catch (err) {
    if (err instanceof CommandNotFoundError) throw ApiError.internal("pct is not available on this host");
    throw err;
  }

  if (input.startOnCreate) {
    try {
      await run("pct", ["start", String(vmid)], { timeoutMs: 120_000 });
    } catch {
      /* container created; start failure is non-fatal for the create response */
    }
  }
  return vmid;
}

// ---------------------------------------------------------------------------
// Community-scripts catalog (community-scripts/ProxmoxVE)
// ---------------------------------------------------------------------------

// Pinned source — NEVER overridable by user input.
const GH_OWNER = "community-scripts";
const GH_REPO = "ProxmoxVE";
const GH_BRANCH = "main";

const RAW_BASE = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}`;
const TREES_URL = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/git/trees/${GH_BRANCH}?recursive=1`;
const METADATA_URL = `${RAW_BASE}/frontend/public/json/metadata.json`;

const CATALOG_TTL_MS = 6 * 60 * 60 * 1000; // ~6h

/** Slug charset shared with the console WS validator. */
export const SCRIPT_SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;

let catalogCache: { at: number; scripts: ScriptMeta[] } | null = null;

/** Build the pinned raw URL for a script. Slug is validated by the caller. */
export function buildCommunityScriptUrl(slug: string): string {
  return `${RAW_BASE}/ct/${slug}.sh`;
}

function humanize(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "proxsyno",
        Accept: "application/json, application/vnd.github+json",
      },
    });
    if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

interface MetadataEntry {
  slug?: string;
  name?: string;
  desc?: string;
  description?: string;
  category?: string;
  categories?: unknown;
}

/** Primary discovery: the repo's aggregate JSON metadata, if present. */
async function discoverFromMetadata(): Promise<ScriptMeta[]> {
  const json = await fetchJson(METADATA_URL);
  const list: MetadataEntry[] = Array.isArray(json)
    ? (json as MetadataEntry[])
    : Array.isArray((json as { scripts?: unknown }).scripts)
      ? ((json as { scripts: MetadataEntry[] }).scripts)
      : [];
  if (list.length === 0) throw new Error("metadata.json had no usable entries");

  const out: ScriptMeta[] = [];
  for (const e of list) {
    const slug = typeof e.slug === "string" ? e.slug : "";
    if (!SCRIPT_SLUG_REGEX.test(slug)) continue;
    const category =
      typeof e.category === "string"
        ? e.category
        : Array.isArray(e.categories) && typeof e.categories[0] === "string"
          ? (e.categories[0] as string)
          : undefined;
    const meta: ScriptMeta = {
      slug,
      name: typeof e.name === "string" && e.name ? e.name : humanize(slug),
      source: `ct/${slug}.sh`,
      url: buildCommunityScriptUrl(slug),
    };
    const description = e.description ?? e.desc;
    if (typeof description === "string" && description) meta.description = description;
    if (category) meta.category = category;
    out.push(meta);
  }
  if (out.length === 0) throw new Error("metadata.json yielded no valid slugs");
  return dedupeBySlug(out);
}

interface TreeEntry {
  path?: string;
  type?: string;
}

/** Fallback discovery: derive scripts from ct/*.sh via the GitHub trees API. */
async function discoverFromTrees(): Promise<ScriptMeta[]> {
  const json = (await fetchJson(TREES_URL)) as { tree?: TreeEntry[] };
  const tree = Array.isArray(json.tree) ? json.tree : [];
  const out: ScriptMeta[] = [];
  for (const node of tree) {
    if (node.type !== "blob" || typeof node.path !== "string") continue;
    const m = node.path.match(/^ct\/([a-z0-9][a-z0-9-]{0,63})\.sh$/);
    if (!m) continue;
    const slug = m[1]!;
    out.push({
      slug,
      name: humanize(slug),
      source: `ct/${slug}.sh`,
      url: buildCommunityScriptUrl(slug),
    });
  }
  if (out.length === 0) throw new Error("no ct/*.sh scripts found in repo tree");
  return dedupeBySlug(out);
}

function dedupeBySlug(scripts: ScriptMeta[]): ScriptMeta[] {
  const seen = new Map<string, ScriptMeta>();
  for (const s of scripts) if (!seen.has(s.slug)) seen.set(s.slug, s);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function discover(): Promise<ScriptMeta[]> {
  try {
    return await discoverFromMetadata();
  } catch {
    return await discoverFromTrees();
  }
}

/**
 * Community-scripts catalog, cached in memory (TTL ~6h). On a network failure we
 * return a stale cache if we have one; otherwise we surface a clear 502.
 */
export async function getScripts(): Promise<ScriptMeta[]> {
  const now = Date.now();
  if (catalogCache && now - catalogCache.at < CATALOG_TTL_MS) {
    return catalogCache.scripts;
  }
  try {
    const scripts = await discover();
    catalogCache = { at: now, scripts };
    return scripts;
  } catch (err) {
    if (catalogCache) return catalogCache.scripts; // serve stale rather than fail
    throw new ApiError(
      502,
      "scripts_unavailable",
      `Could not load community-scripts catalog: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** True if `slug` exists in the (best-effort) cached catalog. Never throws. */
export async function isScriptInCatalog(slug: string): Promise<boolean> {
  if (!SCRIPT_SLUG_REGEX.test(slug)) return false;
  try {
    const scripts = await getScripts();
    return scripts.some((s) => s.slug === slug);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Console PTY (community scripts)
// ---------------------------------------------------------------------------

/**
 * Minimal structural view of a node-pty pseudo-terminal. We avoid importing
 * node-pty's own types so this module type-checks even before the native module
 * is built; the real API (onData/onExit/write/resize/kill) matches this shape.
 */
export interface ConsolePty {
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

type PtySpawn = (
  file: string,
  args: string[],
  opts: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv },
) => ConsolePty;

// node-pty is a native CommonJS addon: load it through createRequire (the same
// approach as auth/pam.ts) so the ESM loader never tries to import the .node file.
const requireCjs = createRequire(import.meta.url);
let ptySpawn: PtySpawn | null = null;

function getPtySpawn(): PtySpawn {
  if (ptySpawn) return ptySpawn;
  const mod = requireCjs("node-pty") as { spawn: PtySpawn };
  ptySpawn = mod.spawn;
  return ptySpawn;
}

/**
 * Spawn the community-script in an interactive PTY. This is the ONLY place a
 * shell command string is constructed, and its only variable is `slug`, which
 * the caller has validated against SCRIPT_SLUG_REGEX *and* the cached catalog.
 * The URL is built solely from pinned constants + that slug.
 */
export function spawnConsolePty(slug: string, cols: number, rows: number): ConsolePty {
  const url = buildCommunityScriptUrl(slug);
  const spawn = getPtySpawn();
  return spawn("bash", ["-lc", `$(curl -fsSL ${url})`], {
    name: "xterm-color",
    cols,
    rows,
    cwd: "/root",
    env: { ...process.env, TERM: "xterm-color" },
  });
}
