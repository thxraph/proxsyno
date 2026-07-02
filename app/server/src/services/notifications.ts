/**
 * Notification center: a periodic health evaluator that turns storage/SMART
 * conditions into edge-triggered notifications, a persistent event log, and
 * pluggable HTTP sinks (ntfy, generic webhook, Telegram).
 *
 * Alerts are edge-triggered: each condition fires ONCE when it appears and logs
 * a "resolved" entry when it clears, so a persistent problem doesn't spam sinks.
 *
 * Note (SSRF): sink URLs are admin-configured and the server POSTs to them by
 * design. Only authenticated admins can set them (same trust level as the env).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { withLock } from "../util/asyncLock.js";
import { run } from "../util/exec.js";
import { listBlockDevices, listRaidArrays, listZfsPools, getSmart } from "./storage.js";
import { getScrubStatus } from "./scrub.js";
import { getSelfTestStatus } from "./smarttest.js";

export type Severity = "info" | "warning" | "critical";

export interface Notification {
  id: string;
  ts: number;
  severity: Severity;
  source: string;
  title: string;
  message: string;
}

export interface SinkNtfy {
  enabled: boolean;
  url: string;
  topic: string;
}
export interface SinkWebhook {
  enabled: boolean;
  url: string;
}
export interface SinkTelegram {
  enabled: boolean;
  botToken: string;
  chatId: string;
}

export interface NotificationSettings {
  /** Only events at or above this severity are sent to sinks. */
  minSeverity: Severity;
  thresholds: { diskPct: number; tempC: number };
  sinks: { ntfy: SinkNtfy; webhook: SinkWebhook; telegram: SinkTelegram };
}

export const DEFAULT_SETTINGS: NotificationSettings = {
  minSeverity: "warning",
  thresholds: { diskPct: 90, tempC: 60 },
  sinks: {
    ntfy: { enabled: false, url: "https://ntfy.sh", topic: "" },
    webhook: { enabled: false, url: "" },
    telegram: { enabled: false, botToken: "", chatId: "" },
  },
};

const SEVERITY_RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 };
const LOG_CAP = 200;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getSettings(): Promise<NotificationSettings> {
  try {
    const raw = JSON.parse(await fs.readFile(config.notificationsSettingsPath, "utf8"));
    // Shallow-merge onto defaults so a partial/older file stays valid.
    return {
      minSeverity: raw.minSeverity ?? DEFAULT_SETTINGS.minSeverity,
      thresholds: { ...DEFAULT_SETTINGS.thresholds, ...(raw.thresholds ?? {}) },
      sinks: {
        ntfy: { ...DEFAULT_SETTINGS.sinks.ntfy, ...(raw.sinks?.ntfy ?? {}) },
        webhook: { ...DEFAULT_SETTINGS.sinks.webhook, ...(raw.sinks?.webhook ?? {}) },
        telegram: { ...DEFAULT_SETTINGS.sinks.telegram, ...(raw.sinks?.telegram ?? {}) },
      },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: NotificationSettings): Promise<NotificationSettings> {
  return withLock(config.notificationsSettingsPath, async () => {
    await fs.mkdir(path.dirname(config.notificationsSettingsPath), { recursive: true });
    const tmp = `${config.notificationsSettingsPath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(settings, null, 2), { mode: 0o600 });
    await fs.rename(tmp, config.notificationsSettingsPath);
    return settings;
  });
}

// ---------------------------------------------------------------------------
// State (event log + active-alert set + read marker)
// ---------------------------------------------------------------------------

interface NotifState {
  readTs: number;
  active: Record<string, number>; // alert key → first-seen ms
  log: Notification[];
}

async function loadState(): Promise<NotifState> {
  try {
    const raw = JSON.parse(await fs.readFile(config.notificationsStatePath, "utf8")) as NotifState;
    return { readTs: raw.readTs ?? 0, active: raw.active ?? {}, log: raw.log ?? [] };
  } catch {
    return { readTs: 0, active: {}, log: [] };
  }
}

async function saveState(state: NotifState): Promise<void> {
  await fs.mkdir(path.dirname(config.notificationsStatePath), { recursive: true });
  const tmp = `${config.notificationsStatePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state), { mode: 0o600 });
  await fs.rename(tmp, config.notificationsStatePath);
}

let seq = 0;
function record(state: NotifState, n: Omit<Notification, "id" | "ts">): Notification {
  const full: Notification = { id: `${Date.now()}-${seq++}`, ts: Date.now(), ...n };
  state.log.unshift(full);
  if (state.log.length > LOG_CAP) state.log.length = LOG_CAP;
  return full;
}

export async function getNotifications(): Promise<{ items: Notification[]; unreadCount: number }> {
  const state = await loadState();
  const unreadCount = state.log.filter((n) => n.ts > state.readTs).length;
  return { items: state.log, unreadCount };
}

export async function markAllRead(): Promise<void> {
  await withLock(config.notificationsStatePath, async () => {
    const state = await loadState();
    state.readTs = Date.now();
    await saveState(state);
  });
}

// ---------------------------------------------------------------------------
// Sinks
// ---------------------------------------------------------------------------

function ntfyPriority(sev: Severity): string {
  return sev === "critical" ? "urgent" : sev === "warning" ? "high" : "default";
}

async function dispatchOne(
  settings: NotificationSettings,
  n: Notification,
): Promise<Array<{ sink: string; ok: boolean; error?: string }>> {
  const results: Array<{ sink: string; ok: boolean; error?: string }> = [];
  const jobs: Array<Promise<void>> = [];
  const timeout = () => AbortSignal.timeout(10_000);

  const { ntfy, webhook, telegram } = settings.sinks;

  if (ntfy.enabled && ntfy.url && ntfy.topic) {
    jobs.push(
      (async () => {
        try {
          const res = await fetch(`${ntfy.url.replace(/\/+$/, "")}/${ntfy.topic}`, {
            method: "POST",
            headers: { Title: n.title, Priority: ntfyPriority(n.severity), Tags: n.severity },
            body: n.message,
            signal: timeout(),
          });
          results.push({ sink: "ntfy", ok: res.ok, error: res.ok ? undefined : `HTTP ${res.status}` });
        } catch (e) {
          results.push({ sink: "ntfy", ok: false, error: (e as Error).message });
        }
      })(),
    );
  }

  if (webhook.enabled && webhook.url) {
    jobs.push(
      (async () => {
        try {
          const res = await fetch(webhook.url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              severity: n.severity,
              source: n.source,
              title: n.title,
              message: n.message,
              ts: n.ts,
            }),
            signal: timeout(),
          });
          results.push({ sink: "webhook", ok: res.ok, error: res.ok ? undefined : `HTTP ${res.status}` });
        } catch (e) {
          results.push({ sink: "webhook", ok: false, error: (e as Error).message });
        }
      })(),
    );
  }

  if (telegram.enabled && telegram.botToken && telegram.chatId) {
    jobs.push(
      (async () => {
        try {
          const res = await fetch(`https://api.telegram.org/bot${telegram.botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: telegram.chatId, text: `${n.title}\n${n.message}` }),
            signal: timeout(),
          });
          results.push({ sink: "telegram", ok: res.ok, error: res.ok ? undefined : `HTTP ${res.status}` });
        } catch (e) {
          results.push({ sink: "telegram", ok: false, error: (e as Error).message });
        }
      })(),
    );
  }

  await Promise.all(jobs);
  return results;
}

/** Send a synthetic notification to every enabled sink (ignores minSeverity). */
export async function sendTest(): Promise<Array<{ sink: string; ok: boolean; error?: string }>> {
  const settings = await getSettings();
  const n: Notification = {
    id: `test-${Date.now()}`,
    ts: Date.now(),
    severity: "info",
    source: "proxsyno",
    title: "proxsyno test notification",
    message: "If you can read this, your notification sink is configured correctly.",
  };
  return dispatchOne(settings, n);
}

// ---------------------------------------------------------------------------
// Health evaluation
// ---------------------------------------------------------------------------

interface Alert {
  key: string;
  severity: Severity;
  source: string;
  title: string;
  message: string;
}

async function readDiskUsage(): Promise<Array<{ source: string; mount: string; pct: number }>> {
  const { stdout } = await run(
    "df",
    ["-P", "-x", "tmpfs", "-x", "devtmpfs", "-x", "overlay", "-x", "squashfs", "-x", "efivarfs"],
    { allowNonZeroExit: true },
  );
  const out: Array<{ source: string; mount: string; pct: number }> = [];
  for (const line of stdout.trim().split("\n").slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 6) continue;
    const pct = Number.parseInt((cols[4] ?? "").replace("%", ""), 10);
    if (!Number.isFinite(pct)) continue;
    out.push({ source: cols[0]!, mount: cols.slice(5).join(" "), pct });
  }
  return out;
}

async function gatherAlerts(settings: NotificationSettings): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const push = (a: Alert): number => alerts.push(a);

  try {
    for (const a of await listRaidArrays()) {
      const degraded = a.total > 0 && a.active < a.total;
      const badState = !/clean|active/i.test(a.state);
      if (degraded || badState) {
        push({
          key: `raid:${a.device}`,
          severity: "critical",
          source: "RAID",
          title: `RAID ${a.device} degraded`,
          message: `${a.device} (${a.level}) state="${a.state}", members ${a.active}/${a.total}`,
        });
      }
    }
  } catch {
    /* mdstat unavailable */
  }

  try {
    for (const s of await getScrubStatus()) {
      if (s.mismatchCnt > 0) {
        push({
          key: `scrub:${s.array}`,
          severity: "warning",
          source: "RAID scrub",
          title: `${s.array}: ${s.mismatchCnt} scrub mismatches`,
          message: `The last consistency check found ${s.mismatchCnt} mismatched sectors on ${s.array}.`,
        });
      }
    }
  } catch {
    /* scrub status unavailable */
  }

  try {
    for (const d of await getSelfTestStatus()) {
      if (d.lastResult && !d.lastResult.passed) {
        push({
          key: `selftest:${d.disk}`,
          severity: "critical",
          source: "SMART",
          title: `${d.disk} self-test failed`,
          message: `${d.disk}: last self-test reported "${d.lastResult.status}".`,
        });
      }
    }
  } catch {
    /* selftest unavailable */
  }

  try {
    const disks = (await listBlockDevices()).filter((d) => d.type === "disk").map((d) => d.name);
    for (const name of disks) {
      const s = await getSmart(name); // 45s-cached; safe at the evaluator's cadence
      if (!s.healthy) {
        push({
          key: `smart:${name}`,
          severity: "critical",
          source: "SMART",
          title: `${name} SMART health failing`,
          message: `${name} reports SMART overall-health not PASSED.`,
        });
      }
      if (typeof s.temperatureC === "number" && s.temperatureC > settings.thresholds.tempC) {
        push({
          key: `temp:${name}`,
          severity: "warning",
          source: "SMART",
          title: `${name} running hot: ${s.temperatureC}°C`,
          message: `${name} temperature ${s.temperatureC}°C exceeds ${settings.thresholds.tempC}°C.`,
        });
      }
    }
  } catch {
    /* smart unavailable */
  }

  try {
    for (const fsu of await readDiskUsage()) {
      if (fsu.pct > settings.thresholds.diskPct) {
        push({
          key: `disk:${fsu.mount}`,
          severity: fsu.pct >= 95 ? "critical" : "warning",
          source: "Storage",
          title: `${fsu.mount} ${fsu.pct}% full`,
          message: `Filesystem ${fsu.mount} (${fsu.source}) is ${fsu.pct}% full.`,
        });
      }
    }
  } catch {
    /* df unavailable */
  }

  try {
    for (const p of await listZfsPools()) {
      if (!/online/i.test(p.health)) {
        push({
          key: `zfs:${p.pool}`,
          severity: "critical",
          source: "ZFS",
          title: `Pool ${p.pool} ${p.health}`,
          message: `ZFS pool ${p.pool} health is ${p.health}.`,
        });
      } else if (p.capPct > settings.thresholds.diskPct) {
        push({
          key: `zfscap:${p.pool}`,
          severity: p.capPct >= 95 ? "critical" : "warning",
          source: "ZFS",
          title: `Pool ${p.pool} ${p.capPct}% full`,
          message: `ZFS pool ${p.pool} is ${p.capPct}% full.`,
        });
      }
    }
  } catch {
    /* zfs unavailable */
  }

  return alerts;
}

/** Evaluate all conditions; fire/resolve edge-triggered notifications. */
export async function runNotificationCheck(): Promise<void> {
  const settings = await getSettings();
  const alerts = await gatherAlerts(settings);

  await withLock(config.notificationsStatePath, async () => {
    const state = await loadState();
    const current = new Map(alerts.map((a) => [a.key, a]));

    // Newly-appeared conditions → fire once.
    for (const a of alerts) {
      if (!(a.key in state.active)) {
        state.active[a.key] = Date.now();
        const n = record(state, {
          severity: a.severity,
          source: a.source,
          title: a.title,
          message: a.message,
        });
        if (SEVERITY_RANK[n.severity] >= SEVERITY_RANK[settings.minSeverity]) {
          await dispatchOne(settings, n);
        }
      }
    }

    // Conditions that cleared → log a resolution (not dispatched).
    for (const key of Object.keys(state.active)) {
      if (!current.has(key)) {
        delete state.active[key];
        record(state, {
          severity: "info",
          source: "System",
          title: `Resolved: ${key}`,
          message: `The condition "${key}" has cleared.`,
        });
      }
    }

    await saveState(state);
  });
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the periodic evaluator. Returns a stop function. */
export function startNotificationEvaluator(): () => void {
  const tick = (): void => {
    runNotificationCheck().catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[proxsyno] notification check failed:", err);
    });
  };
  timer = setInterval(tick, config.notifyIntervalSec * 1000);
  // First pass shortly after boot (don't block startup).
  setTimeout(tick, 10_000).unref();
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}
