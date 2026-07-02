import { describe, it, expect } from "vitest";
import { NAME_REGEX, nameSchema, pathSchema } from "../util/validate.js";

describe("NAME_REGEX / nameSchema", () => {
  const valid = ["abc", "a", "user_1", "A-b_c", "a".repeat(32)];
  for (const name of valid) {
    it(`accepts ${JSON.stringify(name)}`, () => {
      expect(NAME_REGEX.test(name)).toBe(true);
      expect(nameSchema.safeParse(name).success).toBe(true);
    });
  }

  const invalid = [
    ["", "empty"],
    ["-leading", "leading dash"],
    ["1".repeat(33), "33 chars, too long"],
    ["bad name", "space"],
    ["bad/slash", "slash"],
    ["münchen", "non-ascii"],
  ] as const;
  for (const [name, why] of invalid) {
    it(`rejects ${JSON.stringify(name)} (${why})`, () => {
      expect(NAME_REGEX.test(name)).toBe(false);
      expect(nameSchema.safeParse(name).success).toBe(false);
    });
  }
});

describe("pathSchema", () => {
  it("accepts an absolute path", () => {
    expect(pathSchema.safeParse("/mnt/x").success).toBe(true);
  });

  it("rejects a relative path", () => {
    expect(pathSchema.safeParse("relative").success).toBe(false);
  });

  it("rejects a path containing a newline", () => {
    expect(pathSchema.safeParse("/mnt/x\nevil").success).toBe(false);
  });
});
