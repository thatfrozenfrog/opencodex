import { describe, expect, test } from "bun:test";
import { formatUptime } from "../../gui/src/formatUptime";

describe("dashboard uptime formatting", () => {
  test("uses seconds below five minutes", () => {
    expect(formatUptime(0, "en")).toBe("0s");
    expect(formatUptime(299.9, "en")).toBe("299s");
  });
  test("uses minutes, hours and days at their thresholds", () => {
    expect(formatUptime(300, "en")).toBe("5m");
    expect(formatUptime(3599, "en")).toBe("59m");
    expect(formatUptime(3600, "en")).toBe("1h");
    expect(formatUptime(64685, "en")).toBe("17h 58m");
    expect(formatUptime(86400, "en")).toBe("1d");
    expect(formatUptime(183600, "en")).toBe("2d 3h");
  });
});
