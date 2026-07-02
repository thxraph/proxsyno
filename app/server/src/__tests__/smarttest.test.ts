import { describe, it, expect } from "vitest";
import { renderOnCalendar, parseSelftestLog, parseRunning } from "../services/smarttest.js";
import type { SmartTestSchedule } from "../services/smarttest.js";

function schedule(overrides: Partial<SmartTestSchedule>): SmartTestSchedule {
  return {
    frequency: "disabled",
    type: "short",
    weekday: 0,
    day: 1,
    hour: 3,
    minute: 0,
    ...overrides,
  };
}

describe("renderOnCalendar", () => {
  it("renders a weekly schedule on Sunday", () => {
    expect(renderOnCalendar(schedule({ frequency: "weekly", weekday: 0, hour: 2, minute: 0 }))).toBe(
      "Sun *-*-* 02:00:00",
    );
  });

  it("renders a weekly schedule on Wednesday", () => {
    expect(renderOnCalendar(schedule({ frequency: "weekly", weekday: 3, hour: 23, minute: 5 }))).toBe(
      "Wed *-*-* 23:05:00",
    );
  });

  it("renders a monthly schedule", () => {
    expect(renderOnCalendar(schedule({ frequency: "monthly", day: 8, hour: 3, minute: 30 }))).toBe(
      "*-*-08 03:30:00",
    );
  });

  it("returns null when disabled", () => {
    expect(renderOnCalendar(schedule({ frequency: "disabled" }))).toBeNull();
  });

  it("zero-pads hour and minute", () => {
    expect(renderOnCalendar(schedule({ frequency: "weekly", weekday: 0, hour: 1, minute: 1 }))).toBe(
      "Sun *-*-* 01:01:00",
    );
  });
});

const ATA_LOG = `SMART Self-test log structure revision number 1
Num  Test_Description    Status                  Remaining  LifeTime(hours)  LBA_of_first_error
# 1  Short offline       Completed without error       00%     20951         -
# 2  Extended offline    Completed: read failure       90%     20701         0x00000000
# 3  Vendor (0xff)       Completed without error       00%     20567         -`;

describe("parseSelftestLog", () => {
  it("parses each ATA self-test log row", () => {
    const rows = parseSelftestLog(ATA_LOG);
    expect(rows).toHaveLength(3);

    expect(rows[0]).toEqual({
      num: 1,
      description: "Short offline",
      status: "Completed without error",
      passed: true,
      lifetimeHours: 20951,
    });

    expect(rows[1]!.passed).toBe(false);
    expect(rows[1]!.lifetimeHours).toBe(20701);
    expect(rows[1]!.description).toBe("Extended offline");

    expect(rows[2]!.description).toBe("Vendor (0xff)");
  });

  it("returns an empty array when no tests are logged", () => {
    expect(parseSelftestLog("No self-tests have been logged.")).toEqual([]);
  });
});

describe("parseRunning", () => {
  it("returns percent remaining for an ATA test in progress", () => {
    const stdout = "Self-test routine in progress...\n90% of test remaining.";
    expect(parseRunning(stdout)).toBe(90);
  });

  it("returns 0 when in progress without a remaining line", () => {
    expect(parseRunning("Self-test routine in progress...")).toBe(0);
  });

  it("returns undefined when idle", () => {
    expect(parseRunning("The previous self-test routine completed")).toBeUndefined();
  });

  it("returns percent remaining for the NVMe (NN% completed) form", () => {
    expect(parseRunning("Self-test status: Extended self-test in progress (30% completed)")).toBe(70);
  });
});
