/**
 * RAID scrub (data-consistency check) status and scheduling for Linux md arrays.
 *
 * Live state is read from sysfs (/sys/block/<md>/md/*). Schedules are stored in a
 * managed JSON file and executed by per-array systemd timers that run mdadm's
 * `checkarray`. "Scrub now" / "cancel" write directly to the array's sync_action.
 *
 * Every array name is validated against the actual arrays reported by
 * /proc/mdstat before it is used in a sysfs path or a systemd unit name.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { withLock } from "../util/asyncLock.js";
import { ApiError } from "../util/errors.js";
import { run } from "../util/exec.js";
import { listRaidArrays } from "./storage.js";

export type ScrubFrequency = "disabled" | "weekly" | "monthly";

export interface ScrubSchedule {
  frequency: ScrubFrequency;
  /** 0=Sunday … 6=Saturday. Used when frequency is "weekly". */
  weekday: number;
  /** 1..28 day-of-month. Used when frequency is "monthly". */
  day: number;
  hour: number;
  minute: number;
}

export interface ScrubStatus {
  /** Bare array name, e.g. "md0". */
  array: string;
  /** sysfs sync_action: idle | check | repair | resync | recover | reshape | frozen. */
  syncAction: string;
  /** 0..100 while a check is running; omitted when idle. */
  progressPct?: number;
  /** Sector mismatches found by the last/current check. */
  mismatchCnt: number;
  schedule: ScrubSchedule;
  /** Last scheduled run completion (ms epoch), if the timer has ever fired. */
  lastRunMs?: number;
  /** Next scheduled run (ms epoch), if a timer is active. */
  nextRunMs?: number;
}

const DEFAULT_SCHEDULE: ScrubSchedule = {
  frequency: "disabled",
  weekday: 0,
  day: 1,
  hour: 2,
  minute: 0,
};

const ARRAY_RE = /^md\d+$/;
const SERVICE_TEMPLATE = "/etc/systemd/system/proxsyno-scrub@.service";
const CHECKARRAY = "/usr/share/mdadm/checkarray";
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ---------------------------------------------------------------------------
// Schedule store (managed JSON, one entry per array)
// ---------------------------------------------------------------------------

type ScheduleMap = Record<string, ScrubSchedule>;

async function readScheduleMap(): Promise<ScheduleMap> {
  try {
    const text = await fs.readFile(config.scrubStatePath, "utf8");
    return JSON.parse(text) as ScheduleMap;
  } catch {
    return {}; // no file yet / unreadable → nothing scheduled
  }
}

async function writeScheduleMap(map: ScheduleMap): Promise<void> {
  await fs.mkdir(path.dirname(config.scrubStatePath), { recursive: true });
  const tmp = `${config.scrubStatePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(map, null, 2), { mode: 0o600 });
  await fs.rename(tmp, config.scrubStatePath);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Confirm `array` is a real md array (defends the sysfs path and unit name). */
async function assertKnownArray(array: string): Promise<void> {
  if (!ARRAY_RE.test(array)) throw ApiError.badRequest(`Invalid array name: ${array}`);
  const arrays = await listRaidArrays();
  if (!arrays.some((a) => a.device === `/dev/${array}`)) {
    throw ApiError.notFound(`RAID array not found: ${array}`);
  }
}

// ---------------------------------------------------------------------------
// sysfs live state
// ---------------------------------------------------------------------------

async function readSysfs(array: string, attr: string): Promise<string | undefined> {
  try {
    const text = await fs.readFile(`/sys/block/${array}/md/${attr}`, "utf8");
    return text.trim();
  } catch {
    return undefined;
  }
}

/** sync_completed is "<done> / <total>" sectors, or "none" when idle. */
function parseProgress(syncCompleted: string | undefined): number | undefined {
  if (!syncCompleted) return undefined;
  const m = syncCompleted.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) return undefined;
  const done = Number.parseInt(m[1]!, 10);
  const total = Number.parseInt(m[2]!, 10);
  if (!total) return undefined;
  return Math.round((done / total) * 1000) / 10; // one decimal
}

// ---------------------------------------------------------------------------
// systemd timing (best-effort — absent units simply yield no timestamps)
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

/**
 * systemctl renders timestamp properties as a localized string with a timezone
 * abbreviation (e.g. "Sun 2026-07-05 02:00:00 CEST") that Node's Date.parse
 * can't read, and --timestamp=unix isn't honored by `show` here. Convert with
 * `date -d`, which understands the exact string systemd emitted.
 */
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

async function readTiming(array: string): Promise<{ lastRunMs?: number; nextRunMs?: number }> {
  const [lastRaw, nextRaw] = await Promise.all([
    showProperty(`proxsyno-scrub@${array}.service`, "ExecMainExitTimestamp"),
    showProperty(`proxsyno-scrub@${array}.timer`, "NextElapseUSecRealtime"),
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

export async function getScrubStatus(): Promise<ScrubStatus[]> {
  const [arrays, schedules] = await Promise.all([listRaidArrays(), readScheduleMap()]);
  return Promise.all(
    arrays.map(async (a): Promise<ScrubStatus> => {
      const array = a.device.replace(/^\/dev\//, "");
      const [syncAction, syncCompleted, mismatch, timing] = await Promise.all([
        readSysfs(array, "sync_action"),
        readSysfs(array, "sync_completed"),
        readSysfs(array, "mismatch_cnt"),
        readTiming(array),
      ]);
      const status: ScrubStatus = {
        array,
        syncAction: syncAction ?? "unknown",
        mismatchCnt: mismatch ? Number.parseInt(mismatch, 10) || 0 : 0,
        schedule: schedules[array] ?? DEFAULT_SCHEDULE,
      };
      const pct = parseProgress(syncCompleted);
      if (pct !== undefined && syncAction && syncAction !== "idle") status.progressPct = pct;
      if (timing.lastRunMs !== undefined) status.lastRunMs = timing.lastRunMs;
      if (timing.nextRunMs !== undefined) status.nextRunMs = timing.nextRunMs;
      return status;
    }),
  );
}

// ---------------------------------------------------------------------------
// Public: scheduling
// ---------------------------------------------------------------------------

/** systemd OnCalendar expression for a schedule, or null when disabled. */
function renderOnCalendar(s: ScrubSchedule): string | null {
  const time = `${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}:00`;
  if (s.frequency === "weekly") return `${WEEKDAY_NAMES[s.weekday]} *-*-* ${time}`;
  if (s.frequency === "monthly") return `*-*-${String(s.day).padStart(2, "0")} ${time}`;
  return null;
}

async function ensureServiceTemplate(): Promise<void> {
  const unit =
    "[Unit]\n" +
    "Description=proxsyno RAID scrub of /dev/%i\n" +
    "Documentation=man:checkarray(8)\n\n" +
    "[Service]\n" +
    "Type=oneshot\n" +
    "Nice=15\n" +
    "IOSchedulingClass=idle\n" +
    `ExecStart=${CHECKARRAY} --quiet /dev/%i\n`;
  await fs.writeFile(SERVICE_TEMPLATE, unit, { mode: 0o644 });
}

function timerPath(array: string): string {
  return `/etc/systemd/system/proxsyno-scrub@${array}.timer`;
}

async function installTimer(array: string, onCalendar: string): Promise<void> {
  const unit =
    "[Unit]\n" +
    `Description=proxsyno RAID scrub schedule for ${array}\n\n` +
    "[Timer]\n" +
    `OnCalendar=${onCalendar}\n` +
    "Persistent=true\n\n" +
    "[Install]\n" +
    "WantedBy=timers.target\n";
  await fs.writeFile(timerPath(array), unit, { mode: 0o644 });
  await run("systemctl", ["daemon-reload"]);
  await run("systemctl", ["enable", "--now", `proxsyno-scrub@${array}.timer`]);
}

async function removeTimer(array: string): Promise<void> {
  // Best-effort: the timer may not exist yet.
  await run("systemctl", ["disable", "--now", `proxsyno-scrub@${array}.timer`], {
    allowNonZeroExit: true,
  });
  await fs.rm(timerPath(array), { force: true });
  await run("systemctl", ["daemon-reload"]);
}

export async function setScrubSchedule(array: string, schedule: ScrubSchedule): Promise<ScrubStatus> {
  await assertKnownArray(array);
  const onCalendar = renderOnCalendar(schedule);

  await withLock(config.scrubStatePath, async () => {
    const map = await readScheduleMap();
    map[array] = schedule;
    await writeScheduleMap(map);
  });

  if (onCalendar) {
    await ensureServiceTemplate();
    await installTimer(array, onCalendar);
  } else {
    await removeTimer(array);
  }

  const all = await getScrubStatus();
  const one = all.find((s) => s.array === array);
  if (!one) throw ApiError.internal(`Array ${array} vanished after scheduling`);
  return one;
}

// ---------------------------------------------------------------------------
// Public: manual control
// ---------------------------------------------------------------------------

async function writeSyncAction(array: string, action: "check" | "idle"): Promise<void> {
  try {
    await fs.writeFile(`/sys/block/${array}/md/sync_action`, action);
  } catch (err) {
    throw ApiError.internal(`Failed to write sync_action for ${array}: ${(err as Error).message}`);
  }
}

export async function startScrub(array: string): Promise<void> {
  await assertKnownArray(array);
  const current = await readSysfs(array, "sync_action");
  if (current && current !== "idle") {
    throw ApiError.conflict(`${array} is already busy (${current})`);
  }
  await writeSyncAction(array, "check");
}

export async function cancelScrub(array: string): Promise<void> {
  await assertKnownArray(array);
  await writeSyncAction(array, "idle");
}
