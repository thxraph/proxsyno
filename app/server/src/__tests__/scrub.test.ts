import { describe, it, expect } from "vitest";
import { renderOnCalendar, parseProgress } from "../services/scrub.js";
import type { ScrubSchedule } from "../services/scrub.js";

function schedule(overrides: Partial<ScrubSchedule>): ScrubSchedule {
  return { frequency: "disabled", weekday: 0, day: 1, hour: 2, minute: 0, ...overrides };
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

describe("parseProgress", () => {
  it("computes a percentage rounded to one decimal", () => {
    expect(parseProgress("12345 / 67890")).toBeCloseTo(18.2, 1);
  });

  it("returns 0 at the start", () => {
    expect(parseProgress("0 / 100")).toBe(0);
  });

  it("returns 100 when complete", () => {
    expect(parseProgress("100 / 100")).toBe(100);
  });

  it("returns undefined for 'none'", () => {
    expect(parseProgress("none")).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(parseProgress(undefined)).toBeUndefined();
  });

  it("returns undefined instead of dividing by zero", () => {
    expect(parseProgress("5 / 0")).toBeUndefined();
  });

  it("returns undefined for garbage", () => {
    expect(parseProgress("garbage")).toBeUndefined();
  });
});
