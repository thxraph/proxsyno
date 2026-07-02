/**
 * Tests for the notification evaluator: it must turn unhealthy conditions into
 * logged notifications and edge-trigger (fire once, resolve once) correctly.
 *
 * NOTE: env must be set BEFORE the service (and its `config`) is imported, so we
 * assign NOTIFY_STATE / NOTIFY_SETTINGS at the very top and import the service
 * dynamically inside beforeAll.
 */
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

// --- unique temp file paths (env before import) ---------------------------
const stamp = `${process.pid}-${new Date().getTime()}`;
const STATE_PATH = path.join(os.tmpdir(), `proxsyno-notif-state-${stamp}.json`);
const SETTINGS_PATH = path.join(os.tmpdir(), `proxsyno-notif-settings-${stamp}.json`);
process.env.NOTIFY_STATE = STATE_PATH;
process.env.NOTIFY_SETTINGS = SETTINGS_PATH;

// --- mocks (vi.mock is hoisted; factories run at import time) --------------
vi.mock("../services/storage.js", () => ({
  listRaidArrays: vi.fn(),
  listBlockDevices: vi.fn(),
  listZfsPools: vi.fn(),
  getSmart: vi.fn(),
}));
vi.mock("../services/scrub.js", () => ({
  getScrubStatus: vi.fn(),
}));
vi.mock("../services/smarttest.js", () => ({
  getSelfTestStatus: vi.fn(),
}));
vi.mock("../util/exec.js", () => ({
  run: vi.fn(),
}));

// Populated in beforeAll after env is set.
let svc: typeof import("../services/notifications.js");
let storage: typeof import("../services/storage.js");
let scrub: typeof import("../services/scrub.js");
let smarttest: typeof import("../services/smarttest.js");
let exec: typeof import("../util/exec.js");

// Healthy fixtures ---------------------------------------------------------
const healthyRaid = [
  { device: "/dev/md0", level: "raid5", state: "clean", sizeBytes: 0, active: 3, total: 3 },
];
const healthyBlockDevices = [{ name: "sda", type: "disk", sizeBytes: 0 }];
const healthySmart = { device: "/dev/sda", healthy: true, temperatureC: 30 };
const healthyScrub = [
  { array: "md0", syncAction: "idle", mismatchCnt: 0, schedule: { enabled: false } },
];
const healthySelfTest = [{ disk: "sda", history: [], schedule: { enabled: false } }];

function setHealthy(): void {
  vi.mocked(storage.listRaidArrays).mockResolvedValue(healthyRaid as never);
  vi.mocked(storage.listBlockDevices).mockResolvedValue(healthyBlockDevices as never);
  vi.mocked(storage.listZfsPools).mockResolvedValue([] as never);
  vi.mocked(storage.getSmart).mockResolvedValue(healthySmart as never);
  vi.mocked(scrub.getScrubStatus).mockResolvedValue(healthyScrub as never);
  vi.mocked(smarttest.getSelfTestStatus).mockResolvedValue(healthySelfTest as never);
  // `df` returns no data rows => no disk-usage alerts.
  vi.mocked(exec.run).mockResolvedValue({ stdout: "", stderr: "", code: 0 } as never);
}

beforeAll(async () => {
  storage = await import("../services/storage.js");
  scrub = await import("../services/scrub.js");
  smarttest = await import("../services/smarttest.js");
  exec = await import("../util/exec.js");
  svc = await import("../services/notifications.js");
});

// Isolate every test by removing the persisted state file (fresh, empty state)
// and resetting all mocks back to a healthy baseline.
beforeEach(async () => {
  await fs.rm(STATE_PATH, { force: true });
  await fs.rm(SETTINGS_PATH, { force: true });
  setHealthy();
});

describe("notification evaluator", () => {
  it("logs nothing when everything is healthy", async () => {
    await svc.runNotificationCheck();
    const { items } = await svc.getNotifications();
    expect(items.length).toBe(0);
  });

  it("fires a critical alert when a RAID array is degraded", async () => {
    vi.mocked(storage.listRaidArrays).mockResolvedValue([
      { device: "/dev/md0", level: "raid5", state: "clean", sizeBytes: 0, active: 2, total: 3 },
    ] as never);

    await svc.runNotificationCheck();
    const { items, unreadCount } = await svc.getNotifications();

    const raidAlert = items.find(
      (n) => n.severity === "critical" && n.title.includes("md0"),
    );
    expect(raidAlert).toBeDefined();
    expect(unreadCount).toBeGreaterThanOrEqual(1);
  });

  it("edge-triggers: no duplicate on a repeated identical condition, resolves once cleared", async () => {
    const degraded = [
      { device: "/dev/md0", level: "raid5", state: "clean", sizeBytes: 0, active: 2, total: 3 },
    ];
    vi.mocked(storage.listRaidArrays).mockResolvedValue(degraded as never);

    // First check: fires once.
    await svc.runNotificationCheck();
    let items = (await svc.getNotifications()).items;
    const raidAlerts = () =>
      items.filter((n) => n.source === "RAID" && n.title.includes("md0"));
    expect(raidAlerts().length).toBe(1);

    // Second check, SAME degraded state: must NOT add a duplicate.
    await svc.runNotificationCheck();
    items = (await svc.getNotifications()).items;
    expect(raidAlerts().length).toBe(1);

    // Third check, now healthy again: appends a "Resolved:" info entry.
    setHealthy();
    await svc.runNotificationCheck();
    items = (await svc.getNotifications()).items;
    expect(raidAlerts().length).toBe(1); // original alert still there, no new one
    const resolved = items.find(
      (n) => n.severity === "info" && n.title.startsWith("Resolved:") && n.title.includes("md0"),
    );
    expect(resolved).toBeDefined();
  });

  it("fires a critical alert when a SMART self-test failed", async () => {
    vi.mocked(smarttest.getSelfTestStatus).mockResolvedValue([
      {
        disk: "sda",
        lastResult: { num: 1, description: "Short", status: "read failure", passed: false },
        history: [{ num: 1, description: "Short", status: "read failure", passed: false }],
        schedule: { enabled: false },
      },
    ] as never);

    await svc.runNotificationCheck();
    const { items } = await svc.getNotifications();

    const selftestAlert = items.find(
      (n) => n.severity === "critical" && n.source === "SMART" && n.title.includes("sda"),
    );
    expect(selftestAlert).toBeDefined();
  });

  it("markAllRead() resets unreadCount to 0", async () => {
    vi.mocked(storage.listRaidArrays).mockResolvedValue([
      { device: "/dev/md0", level: "raid5", state: "clean", sizeBytes: 0, active: 2, total: 3 },
    ] as never);

    await svc.runNotificationCheck();
    expect((await svc.getNotifications()).unreadCount).toBeGreaterThanOrEqual(1);

    await svc.markAllRead();
    expect((await svc.getNotifications()).unreadCount).toBe(0);
  });
});
