/**
 * Host telemetry: static info (/api/system) and a live sampler used by the
 * /ws/system WebSocket. All reads come from node:os and /proc; no user input.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import { run, CommandNotFoundError } from "../util/exec.js";

export interface SystemInfo {
  hostname: string;
  os: string;
  kernel: string;
  uptimeSec: number;
  cpu: { model: string; cores: number; loadAvg: [number, number, number] };
  mem: { totalKb: number; usedKb: number; freeKb: number };
  isProxmox: boolean;
  pveVersion?: string;
}

/** Parse /etc/os-release into a friendly distro string, falling back to os info. */
async function readOsRelease(): Promise<string> {
  try {
    const text = await fs.readFile("/etc/os-release", "utf8");
    const map = new Map<string, string>();
    for (const line of text.split("\n")) {
      const idx = line.indexOf("=");
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim().replace(/^"|"$/g, "");
      map.set(key, val);
    }
    return map.get("PRETTY_NAME") ?? map.get("NAME") ?? `${os.type()} ${os.release()}`;
  } catch {
    return `${os.type()} ${os.release()}`;
  }
}

/** /proc/meminfo gives accurate free/available; node:os only has free. */
async function readMemInfoKb(): Promise<{ totalKb: number; freeKb: number; usedKb: number }> {
  try {
    const text = await fs.readFile("/proc/meminfo", "utf8");
    const get = (key: string): number => {
      const m = text.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB`, "m"));
      return m ? Number.parseInt(m[1]!, 10) : 0;
    };
    const totalKb = get("MemTotal");
    // Prefer MemAvailable (accounts for reclaimable cache) for "free".
    const availableKb = get("MemAvailable") || get("MemFree");
    return { totalKb, freeKb: availableKb, usedKb: Math.max(0, totalKb - availableKb) };
  } catch {
    const totalKb = Math.round(os.totalmem() / 1024);
    const freeKb = Math.round(os.freemem() / 1024);
    return { totalKb, freeKb, usedKb: Math.max(0, totalKb - freeKb) };
  }
}

/** Detect Proxmox VE and its version via `pveversion`. Best-effort. */
async function detectProxmox(): Promise<{ isProxmox: boolean; pveVersion?: string }> {
  try {
    const { stdout } = await run("pveversion", [], { timeoutMs: 5000 });
    const line = stdout.trim().split("\n")[0] ?? "";
    // e.g. "pve-manager/8.2.2/9355359cdf9b6909 (running kernel: 6.8.4-2-pve)"
    const m = line.match(/pve-manager\/([^\s/]+)/);
    return { isProxmox: true, pveVersion: m ? m[1] : line || undefined };
  } catch (err) {
    if (err instanceof CommandNotFoundError) return { isProxmox: false };
    // pveversion exists but errored — still treat host as proxmox-ish.
    return { isProxmox: false };
  }
}

export async function getSystemInfo(): Promise<SystemInfo> {
  const [osName, mem, pve] = await Promise.all([readOsRelease(), readMemInfoKb(), detectProxmox()]);
  const cpus = os.cpus();
  const load = os.loadavg();

  return {
    hostname: os.hostname(),
    os: osName,
    kernel: os.release(),
    uptimeSec: Math.round(os.uptime()),
    cpu: {
      model: cpus[0]?.model?.trim() ?? "unknown",
      cores: cpus.length,
      loadAvg: [load[0] ?? 0, load[1] ?? 0, load[2] ?? 0],
    },
    mem,
    isProxmox: pve.isProxmox,
    pveVersion: pve.pveVersion,
  };
}

// ---------------------------------------------------------------------------
// Live sampler (WebSocket)
// ---------------------------------------------------------------------------

interface CpuTimes {
  idle: number;
  total: number;
}

interface NetCounters {
  rx: number;
  tx: number;
}

export interface SystemSample {
  tsMs: number;
  cpuPct: number;
  mem: { usedKb: number; totalKb: number };
  net: Array<{ iface: string; rxBps: number; txBps: number }>;
  load: [number, number, number];
}

/**
 * Stateful per-connection sampler: CPU% and net Bps are deltas, so each
 * WebSocket connection keeps its own previous-reading baseline.
 */
export class SystemSampler {
  private prevCpu: CpuTimes | null = null;
  private prevNet: Map<string, NetCounters> = new Map();
  private prevTsMs = 0;

  private static aggregateCpuTimes(): CpuTimes {
    let idle = 0;
    let total = 0;
    for (const c of os.cpus()) {
      const t = c.times;
      idle += t.idle;
      total += t.user + t.nice + t.sys + t.idle + t.irq;
    }
    return { idle, total };
  }

  private static async readNet(): Promise<Map<string, NetCounters>> {
    const result = new Map<string, NetCounters>();
    try {
      const text = await fs.readFile("/proc/net/dev", "utf8");
      for (const line of text.split("\n")) {
        const m = line.match(/^\s*([^:]+):\s*(.*)$/);
        if (!m) continue;
        const iface = m[1]!.trim();
        if (iface === "lo") continue;
        const cols = m[2]!.trim().split(/\s+/).map((n) => Number.parseInt(n, 10));
        // Receive bytes = col[0], Transmit bytes = col[8].
        result.set(iface, { rx: cols[0] ?? 0, tx: cols[8] ?? 0 });
      }
    } catch {
      /* /proc/net/dev unavailable — return empty */
    }
    return result;
  }

  /** Take one sample. The first call returns 0 deltas (no baseline yet). */
  async sample(): Promise<SystemSample> {
    const now = Date.now();
    const cpu = SystemSampler.aggregateCpuTimes();
    const net = await SystemSampler.readNet();
    const mem = await readMemInfoKb();
    const load = os.loadavg();

    // CPU%: 1 - (idleDelta / totalDelta)
    let cpuPct = 0;
    if (this.prevCpu) {
      const idleDelta = cpu.idle - this.prevCpu.idle;
      const totalDelta = cpu.total - this.prevCpu.total;
      cpuPct = totalDelta > 0 ? Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100)) : 0;
    }
    this.prevCpu = cpu;

    // Net Bps per interface from byte-counter deltas / elapsed seconds.
    const elapsedSec = this.prevTsMs ? (now - this.prevTsMs) / 1000 : 0;
    const netOut: SystemSample["net"] = [];
    for (const [iface, cur] of net) {
      const prev = this.prevNet.get(iface);
      if (prev && elapsedSec > 0) {
        netOut.push({
          iface,
          rxBps: Math.max(0, Math.round((cur.rx - prev.rx) / elapsedSec)),
          txBps: Math.max(0, Math.round((cur.tx - prev.tx) / elapsedSec)),
        });
      } else {
        netOut.push({ iface, rxBps: 0, txBps: 0 });
      }
    }
    this.prevNet = net;
    this.prevTsMs = now;

    return {
      tsMs: now,
      cpuPct: Math.round(cpuPct * 10) / 10,
      mem: { usedKb: mem.usedKb, totalKb: mem.totalKb },
      net: netOut,
      load: [load[0] ?? 0, load[1] ?? 0, load[2] ?? 0],
    };
  }
}
