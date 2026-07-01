/**
 * SMART self-test status and scheduling for physical disks.
 *
 * Reads the drive's self-test log and execution status via `smartctl`, runs
 * short/long tests on demand, and installs per-disk systemd timers for a
 * recurring schedule. A self-test is internal to the drive and non-destructive.
 *
 * Every disk name is validated against the real block devices before it is used
 * in a device path or a systemd unit name.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { withLock } from "../util/asyncLock.js";
import { ApiError } from "../util/errors.js";
import { run, CommandNotFoundError } from "../util/exec.js";
import { listBlockDevices } from "./storage.js";

export type SmartTestType = "short" | "long";
export type SmartTestFrequency = "disabled" | "weekly" | "monthly";

export interface SmartTestSchedule {
  frequency: SmartTestFrequency;
  type: SmartTestType;
  /** 0=Sunday … 6=Saturday (weekly). */
  weekday: number;
  /** 1..28 day-of-month (monthly). */
  day: number;
  hour: number;
  minute: number;
}

export interface SmartTestResult {
  num: number;
  description: string;
  status: string;
  /** true only when the drive reported "completed without error". */
  passed: boolean;
  lifetimeHours?: number;
}

export interface SmartTestStatus {
  disk: string;
  /** Present while a self-test is executing. */
  running?: { remainingPct: number };
  lastResult?: SmartTestResult;
  history: SmartTestResult[];
  schedule: SmartTestSchedule;
  lastRunMs?: number;
  nextRunMs?: number;
}

const DEFAULT_SCHEDULE: SmartTestSchedule = {
  frequency: "disabled",
  type: "short",
  weekday: 0,
  day: 1,
  hour: 3,
  minute: 0,
};

const DISK_RE = /^[a-zA-Z0-9]([a-zA-Z0-9_-]*[a-zA-Z0-9])?$/;
const SMARTCTL = "/usr/sbin/smartctl";
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ---------------------------------------------------------------------------
// Schedule store (managed JSON, one entry per disk)
// ---------------------------------------------------------------------------

type ScheduleMap = Record<string, SmartTestSchedule>;

async function readScheduleMap(): Promise<ScheduleMap> {
  try {
    return JSON.parse(await fs.readFile(config.selftestStatePath, "utf8")) as ScheduleMap;
  } catch {
    return {};
  }
}

async function writeScheduleMap(map: ScheduleMap): Promise<void> {
  await fs.mkdir(path.dirname(config.selftestStatePath), { recursive: true });
  const tmp = `${config.selftestStatePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(map, null, 2), { mode: 0o600 });
  await fs.rename(tmp, config.selftestStatePath);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Physical disks (lsblk type "disk"). */
async function listDiskNames(): Promise<string[]> {
  const devices = await listBlockDevices();
  return devices.filter((d) => d.type === "disk").map((d) => d.name);
}

async function assertKnownDisk(disk: string): Promise<void> {
  if (!DISK_RE.test(disk)) throw ApiError.badRequest(`Invalid disk name: ${disk}`);
  const disks = await listDiskNames();
  if (!disks.includes(disk)) throw ApiError.notFound(`Disk not found: ${disk}`);
}

// ---------------------------------------------------------------------------
// smartctl parsing
// ---------------------------------------------------------------------------

/**
 * ATA self-test log rows look like:
 *   # 1  Short offline       Completed without error       00%      6161         -
 * with the description and status separated by runs of 2+ spaces.
 */
function parseSelftestLog(stdout: string): SmartTestResult[] {
  const rows: SmartTestResult[] = [];
  const re = /^#\s*(\d+)\s+(.+?)\s{2,}(.+?)\s{2,}\d+%\s+(\d+)\b/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stdout)) !== null) {
    const status = m[3]!.trim();
    rows.push({
      num: Number.parseInt(m[1]!, 10),
      description: m[2]!.trim(),
      status,
      passed: /without error/i.test(status),
      lifetimeHours: Number.parseInt(m[4]!, 10),
    });
  }
  return rows;
}

/** Execution status → percent remaining while a test runs, else undefined. */
function parseRunning(stdout: string): number | undefined {
  // ATA: "Self-test routine in progress..." + "90% of test remaining."
  if (/self-test routine in progress/i.test(stdout) || /self-test in progress/i.test(stdout)) {
    const rem = stdout.match(/(\d+)%\s+of\s+test\s+remaining/i);
    return rem ? Number.parseInt(rem[1]!, 10) : 0;
  }
  // NVMe: "Self-test status: ... in progress (NN% completed)"
  const nvme = stdout.match(/self-test.*in progress\s*\((\d+)%\s*complete/i);
  if (nvme) return 100 - Number.parseInt(nvme[1]!, 10);
  return undefined;
}

// ---------------------------------------------------------------------------
// systemd timing (best-effort)
// ---------------------------------------------------------------------------

async function showProperty(unit: string, property: string): Promise<string> {
  try {
    const { stdout } = await run("systemctl", ["show", unit, "-p", property, "--value"], {
      allowNonZeroExit: true,
      timeoutMs: 5000,
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

async function toEpochMs(systemdTs: string): Promise<number | undefined> {
  if (!systemdTs) return undefined;
  try {
    const { stdout } = await run("date", ["-d", systemdTs, "+%s"], { timeoutMs: 5000 });
    const sec = Number.parseInt(stdout.trim(), 10);
    return Number.isFinite(sec) ? sec * 1000 : undefined;
  } catch {
    return undefined;
  }
}

async function readTiming(disk: string): Promise<{ lastRunMs?: number; nextRunMs?: number }> {
  const [lastRaw, nextRaw] = await Promise.all([
    showProperty(`proxsyno-selftest-${disk}.service`, "ExecMainExitTimestamp"),
    showProperty(`proxsyno-selftest-${disk}.timer`, "NextElapseUSecRealtime"),
  ]);
  const [lastRunMs, nextRunMs] = await Promise.all([toEpochMs(lastRaw), toEpochMs(nextRaw)]);
  const out: { lastRunMs?: number; nextRunMs?: number } = {};
  if (lastRunMs !== undefined) out.lastRunMs = lastRunMs;
  if (nextRunMs !== undefined) out.nextRunMs = nextRunMs;
  return out;
}

// ---------------------------------------------------------------------------
// Public: status
// ---------------------------------------------------------------------------

async function readDiskStatus(disk: string, schedule: SmartTestSchedule): Promise<SmartTestStatus> {
  let stdout = "";
  try {
    // -l selftest = test log, -c = capabilities/execution status. Non-zero exit
    // is a smartctl status bitmask even on healthy drives, so allow it.
    const res = await run(SMARTCTL, ["-c", "-l", "selftest", `/dev/${disk}`], {
      allowNonZeroExit: true,
      timeoutMs: 15000,
    });
    stdout = res.stdout;
  } catch (err) {
    if (!(err instanceof CommandNotFoundError)) throw err;
    // smartctl missing → report an empty, unscheduled-looking status.
  }

  const history = parseSelftestLog(stdout);
  const timing = await readTiming(disk);
  const status: SmartTestStatus = { disk, history, schedule };
  if (history[0]) status.lastResult = history[0];
  const remaining = parseRunning(stdout);
  if (remaining !== undefined) status.running = { remainingPct: remaining };
  if (timing.lastRunMs !== undefined) status.lastRunMs = timing.lastRunMs;
  if (timing.nextRunMs !== undefined) status.nextRunMs = timing.nextRunMs;
  return status;
}

export async function getSelfTestStatus(): Promise<SmartTestStatus[]> {
  const [disks, schedules] = await Promise.all([listDiskNames(), readScheduleMap()]);
  return Promise.all(disks.map((d) => readDiskStatus(d, schedules[d] ?? DEFAULT_SCHEDULE)));
}

// ---------------------------------------------------------------------------
// Public: scheduling
// ---------------------------------------------------------------------------

function renderOnCalendar(s: SmartTestSchedule): string | null {
  const time = `${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}:00`;
  if (s.frequency === "weekly") return `${WEEKDAY_NAMES[s.weekday]} *-*-* ${time}`;
  if (s.frequency === "monthly") return `*-*-${String(s.day).padStart(2, "0")} ${time}`;
  return null;
}

function servicePath(disk: string): string {
  return `/etc/systemd/system/proxsyno-selftest-${disk}.service`;
}
function timerPath(disk: string): string {
  return `/etc/systemd/system/proxsyno-selftest-${disk}.timer`;
}

async function installUnits(disk: string, type: SmartTestType, onCalendar: string): Promise<void> {
  const service =
    "[Unit]\n" +
    `Description=proxsyno SMART ${type} self-test of /dev/${disk}\n\n` +
    "[Service]\n" +
    "Type=oneshot\n" +
    `ExecStart=${SMARTCTL} -t ${type} /dev/${disk}\n`;
  const timer =
    "[Unit]\n" +
    `Description=proxsyno SMART self-test schedule for ${disk}\n\n` +
    "[Timer]\n" +
    `OnCalendar=${onCalendar}\n` +
    "Persistent=true\n\n" +
    "[Install]\n" +
    "WantedBy=timers.target\n";
  await fs.writeFile(servicePath(disk), service, { mode: 0o644 });
  await fs.writeFile(timerPath(disk), timer, { mode: 0o644 });
  await run("systemctl", ["daemon-reload"]);
  await run("systemctl", ["enable", "--now", `proxsyno-selftest-${disk}.timer`]);
}

async function removeUnits(disk: string): Promise<void> {
  await run("systemctl", ["disable", "--now", `proxsyno-selftest-${disk}.timer`], {
    allowNonZeroExit: true,
  });
  await fs.rm(timerPath(disk), { force: true });
  await fs.rm(servicePath(disk), { force: true });
  await run("systemctl", ["daemon-reload"]);
}

export async function setSelfTestSchedule(
  disk: string,
  schedule: SmartTestSchedule,
): Promise<SmartTestStatus> {
  await assertKnownDisk(disk);
  const onCalendar = renderOnCalendar(schedule);

  await withLock(config.selftestStatePath, async () => {
    const map = await readScheduleMap();
    map[disk] = schedule;
    await writeScheduleMap(map);
  });

  if (onCalendar) await installUnits(disk, schedule.type, onCalendar);
  else await removeUnits(disk);

  return readDiskStatus(disk, schedule);
}

// ---------------------------------------------------------------------------
// Public: manual control
// ---------------------------------------------------------------------------

export async function startSelfTest(disk: string, type: SmartTestType): Promise<void> {
  await assertKnownDisk(disk);
  try {
    // smartctl exits non-zero on the status bitmask even when the test starts;
    // detect a genuine "can't start" by looking for the confirmation line.
    const { stdout } = await run(SMARTCTL, ["-t", type, `/dev/${disk}`], {
      allowNonZeroExit: true,
      timeoutMs: 15000,
    });
    if (!/has begun|test( has)? started|testing has begun/i.test(stdout)) {
      if (/can't start|already in progress|previous self-test/i.test(stdout)) {
        throw ApiError.conflict(`A self-test is already running on ${disk}`);
      }
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof CommandNotFoundError) throw ApiError.internal("smartctl is not installed");
    throw err;
  }
}

export async function cancelSelfTest(disk: string): Promise<void> {
  await assertKnownDisk(disk);
  try {
    await run(SMARTCTL, ["-X", `/dev/${disk}`], { allowNonZeroExit: true, timeoutMs: 15000 });
  } catch (err) {
    if (err instanceof CommandNotFoundError) throw ApiError.internal("smartctl is not installed");
    throw err;
  }
}
