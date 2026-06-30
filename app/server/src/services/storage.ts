/**
 * Read-only storage introspection: block devices (lsblk), Linux md RAID
 * (/proc/mdstat + mdadm), ZFS pools (zpool), and SMART health (smartctl).
 *
 * Every helper degrades gracefully: if a tool is missing or fails we return an
 * empty result (or throw a 404-ish ApiError for SMART) rather than 500-ing.
 */
import { promises as fs } from "node:fs";
import { run, CommandNotFoundError } from "../util/exec.js";
import { ApiError } from "../util/errors.js";

export type BlockDeviceType = "disk" | "part" | "raid" | "lvm" | "crypt" | "rom" | "loop" | string;

export interface BlockDevice {
  name: string;
  sizeBytes: number;
  model?: string;
  type: BlockDeviceType;
  fstype?: string;
  mountpoint?: string;
  serial?: string;
  children?: BlockDevice[];
}

interface LsblkNode {
  name: string;
  size?: number | string;
  model?: string | null;
  type?: string;
  fstype?: string | null;
  mountpoint?: string | null;
  mountpoints?: (string | null)[];
  serial?: string | null;
  children?: LsblkNode[];
}

function mapLsblkNode(n: LsblkNode): BlockDevice {
  // lsblk -b emits numeric sizes, but JSON may stringify them; coerce safely.
  const size = typeof n.size === "string" ? Number.parseInt(n.size, 10) : (n.size ?? 0);
  const mountpoint =
    n.mountpoint ?? (Array.isArray(n.mountpoints) ? n.mountpoints.find((m) => m) ?? undefined : undefined);

  const dev: BlockDevice = {
    name: n.name,
    sizeBytes: Number.isFinite(size) ? size : 0,
    type: (n.type ?? "disk") as BlockDeviceType,
  };
  if (n.model) dev.model = n.model.trim();
  if (n.fstype) dev.fstype = n.fstype;
  if (mountpoint) dev.mountpoint = mountpoint;
  if (n.serial) dev.serial = n.serial.trim();
  if (n.children?.length) dev.children = n.children.map(mapLsblkNode);
  return dev;
}

export async function listBlockDevices(): Promise<BlockDevice[]> {
  try {
    // -J json, -b bytes, -O all columns. Args array — no shell.
    const { stdout } = await run("lsblk", ["-J", "-b", "-O"]);
    const parsed = JSON.parse(stdout) as { blockdevices?: LsblkNode[] };
    return (parsed.blockdevices ?? []).map(mapLsblkNode);
  } catch (err) {
    if (err instanceof CommandNotFoundError) return [];
    throw err;
  }
}

// ---------------------------------------------------------------------------
// md RAID
// ---------------------------------------------------------------------------

export interface RaidArray {
  device: string;
  level: string;
  state: string;
  sizeBytes: number;
  active: number;
  total: number;
  syncPct?: number;
}

/** Parse /proc/mdstat for active arrays, then enrich each with mdadm --detail. */
export async function listRaidArrays(): Promise<RaidArray[]> {
  let mdstat: string;
  try {
    mdstat = await fs.readFile("/proc/mdstat", "utf8");
  } catch {
    return []; // no md subsystem
  }

  const arrays: RaidArray[] = [];
  const blocks = mdstat.split(/\n(?=md\d)/); // split on lines beginning with mdN
  for (const block of blocks) {
    const header = block.match(/^(md\d+)\s*:\s*(\S+)\s+(\S+)?/);
    if (!header) continue;
    const device = `/dev/${header[1]}`;
    const state = header[2] ?? "unknown"; // "active" / "inactive"
    const level = header[3] ?? "unknown"; // e.g. raid1

    // [n/m] [UU_] gives total/active counts.
    const counts = block.match(/\[(\d+)\/(\d+)\]/);
    const total = counts ? Number.parseInt(counts[1]!, 10) : 0;
    const active = counts ? Number.parseInt(counts[2]!, 10) : 0;

    // recovery/resync line: "recovery = 12.3% ..."
    const sync = block.match(/(?:recovery|resync|reshape|check)\s*=\s*([\d.]+)%/);

    const arr: RaidArray = {
      device,
      level,
      state,
      sizeBytes: 0,
      active,
      total,
    };
    if (sync) arr.syncPct = Number.parseFloat(sync[1]!);

    // Enrich with mdadm --detail for accurate size/state. Best-effort.
    try {
      const { stdout } = await run("mdadm", ["--detail", device]);
      const arraySize = stdout.match(/Array Size\s*:\s*(\d+)/);
      if (arraySize) arr.sizeBytes = Number.parseInt(arraySize[1]!, 10) * 1024; // KiB → bytes
      const detailState = stdout.match(/State\s*:\s*(.+)/);
      if (detailState) arr.state = detailState[1]!.trim();
      const detailLevel = stdout.match(/Raid Level\s*:\s*(\S+)/);
      if (detailLevel) arr.level = detailLevel[1]!;
    } catch {
      /* mdadm missing or array not detailed — keep mdstat-derived values */
    }

    arrays.push(arr);
  }
  return arrays;
}

// ---------------------------------------------------------------------------
// ZFS
// ---------------------------------------------------------------------------

export interface ZfsPool {
  pool: string;
  sizeBytes: number;
  allocBytes: number;
  freeBytes: number;
  health: string;
  capPct: number;
}

/** `zpool list -Hp` → parseable columns. Empty if zfs absent. */
export async function listZfsPools(): Promise<ZfsPool[]> {
  try {
    // -H no header, -p parseable (exact bytes / integer percent).
    // -o pins column order so parsing is stable.
    const { stdout } = await run("zpool", ["list", "-Hp", "-o", "name,size,alloc,free,capacity,health"]);
    const pools: ZfsPool[] = [];
    for (const line of stdout.split("\n")) {
      if (!line.trim()) continue;
      const [name, size, alloc, free, cap, health] = line.split("\t");
      pools.push({
        pool: name ?? "",
        sizeBytes: Number.parseInt(size ?? "0", 10) || 0,
        allocBytes: Number.parseInt(alloc ?? "0", 10) || 0,
        freeBytes: Number.parseInt(free ?? "0", 10) || 0,
        capPct: Number.parseInt((cap ?? "0").replace("%", ""), 10) || 0,
        health: health ?? "UNKNOWN",
      });
    }
    return pools;
  } catch (err) {
    if (err instanceof CommandNotFoundError) return [];
    // zpool exists but no pools / not loaded → treat as empty.
    return [];
  }
}

// ---------------------------------------------------------------------------
// SMART
// ---------------------------------------------------------------------------

export interface SmartInfo {
  device: string;
  healthy: boolean;
  temperatureC?: number;
  powerOnHours?: number;
  raw?: string;
}

/**
 * `smartctl -H -A /dev/<disk>`. Accepts a bare disk name (e.g. "sda") which we
 * normalise to /dev/<name>; the caller has already validated it against a safe
 * device-name pattern.
 */
export async function getSmart(diskName: string): Promise<SmartInfo> {
  const device = diskName.startsWith("/dev/") ? diskName : `/dev/${diskName}`;

  let stdout: string;
  try {
    // smartctl returns a non-zero bitmask even on healthy disks; allow it.
    const res = await run("smartctl", ["-H", "-A", device], { allowNonZeroExit: true });
    stdout = res.stdout;
    if (!stdout.trim()) {
      throw ApiError.notFound(`No SMART data for ${device}`);
    }
  } catch (err) {
    if (err instanceof CommandNotFoundError) {
      // Degrade gracefully: report unknown health rather than 500.
      return { device, healthy: false, raw: "smartctl not installed" };
    }
    throw err;
  }

  // Overall health line.
  const healthMatch = stdout.match(/SMART overall-health self-assessment test result:\s*(\S+)/i);
  const healthy = healthMatch ? /pass/i.test(healthMatch[1]!) : false;

  // Temperature: prefer the dedicated attribute, fall back to "Temperature_Celsius".
  let temperatureC: number | undefined;
  const tempAttr =
    stdout.match(/Temperature_Celsius[^\n]*?(\d+)(?:\s|$)/) ||
    stdout.match(/Current Drive Temperature:\s*(\d+)/) ||
    stdout.match(/Temperature:\s*(\d+)\s*Celsius/);
  if (tempAttr) temperatureC = Number.parseInt(tempAttr[1]!, 10);

  // Power-on hours.
  let powerOnHours: number | undefined;
  const pohAttr =
    stdout.match(/Power_On_Hours[^\n]*?(\d+)(?:\s|$)/) ||
    stdout.match(/number of hours powered up\s*=\s*([\d.]+)/i) ||
    stdout.match(/Power on time:\s*(\d+)/i);
  if (pohAttr) powerOnHours = Math.round(Number.parseFloat(pohAttr[1]!));

  const info: SmartInfo = { device, healthy, raw: stdout };
  if (temperatureC !== undefined) info.temperatureC = temperatureC;
  if (powerOnHours !== undefined) info.powerOnHours = powerOnHours;
  return info;
}
