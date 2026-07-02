import { describe, it, expect } from "vitest";
import { parseSmart } from "../services/storage.js";

describe("parseSmart", () => {
  it("reads temp and power-on-hours from RAW_VALUE (last column), not the FLAG column", () => {
    // Regression: ATA rows are ID# NAME FLAG VALUE WORST THRESH TYPE UPDATED
    // WHEN_FAILED RAW_VALUE. The value must come from the LAST column.
    const stdout = [
      "SMART overall-health self-assessment test result: PASSED",
      "  9 Power_On_Hours          0x0032   034   034   000    Old_age   Always       -       48613",
      "194 Temperature_Celsius     0x0022   119   097   000    Old_age   Always       -       31",
    ].join("\n");

    const info = parseSmart(stdout, "/dev/sda");
    expect(info.healthy).toBe(true);
    expect(info.temperatureC).toBe(31); // NOT 22 (from the 0x0022 flag)
    expect(info.powerOnHours).toBe(48613); // NOT 32 (from the 0x0032 flag)
  });

  it("marks unhealthy when the overall result is FAILED!", () => {
    const stdout = "SMART overall-health self-assessment test result: FAILED!";
    const info = parseSmart(stdout, "/dev/sdb");
    expect(info.healthy).toBe(false);
  });

  it("parses the leading integer of a RAW_VALUE with a Min/Max suffix", () => {
    const stdout = [
      "SMART overall-health self-assessment test result: PASSED",
      "194 Temperature_Celsius     0x0022   119   097   000    Old_age   Always       -       35 (Min/Max 20/45)",
    ].join("\n");
    const info = parseSmart(stdout, "/dev/sdc");
    expect(info.temperatureC).toBe(35);
  });

  it("falls back to 'Current Drive Temperature' (SCSI)", () => {
    const stdout = [
      "SMART overall-health self-assessment test result: PASSED",
      "Current Drive Temperature:     34 C",
    ].join("\n");
    const info = parseSmart(stdout, "/dev/sdd");
    expect(info.temperatureC).toBe(34);
  });

  it("falls back to 'Temperature: N Celsius' (NVMe)", () => {
    const stdout = [
      "SMART overall-health self-assessment test result: PASSED",
      "Temperature:                        40 Celsius",
    ].join("\n");
    const info = parseSmart(stdout, "/dev/nvme0");
    expect(info.temperatureC).toBe(40);
  });

  it("returns unhealthy with undefined metrics on empty/garbage input", () => {
    for (const stdout of ["", "   \n  ", "not smart output at all"]) {
      const info = parseSmart(stdout, "/dev/sde");
      expect(info.healthy).toBe(false);
      expect(info.temperatureC).toBeUndefined();
      expect(info.powerOnHours).toBeUndefined();
    }
  });

  it("passes the device string through unchanged", () => {
    const info = parseSmart("", "/dev/whatever0");
    expect(info.device).toBe("/dev/whatever0");
  });
});
