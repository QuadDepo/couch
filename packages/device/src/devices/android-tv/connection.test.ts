import { describe, expect, test } from "bun:test";
import { createADBConnection } from "./connection";

describe("Android TV ADB readiness probe", () => {
  test.each([
    ["ready", ["connected to 192.0.2.10:5555", "ok"]],
    ["unauthorized", ["connected to 192.0.2.10:5555", "error: device unauthorized"]],
    ["offline", ["failed to connect to 192.0.2.10:5555: Connection refused"]],
  ] as const)("reports %s from command output", async (expected, outputs) => {
    let index = 0;
    const connection = createADBConnection("192.0.2.10", {
      runCommand: async () => outputs[index++] ?? "",
    });

    await expect(connection.getReadiness?.()).resolves.toBe(expected);
  });

  test.each([
    ["missing-tool", Object.assign(new Error("spawn adb ENOENT"), { code: "ENOENT" })],
    ["missing-tool", new Error("Failed to spawn adb")],
    ["offline", new Error("error: device 192.0.2.10:5555 not found")],
    ["offline", new Error("error: device serial-123 not found")],
    ["offline", new Error("Failed to execute adb: error: device serial-123 not found")],
    ["unauthorized", new Error("error: device unauthorized")],
  ] as const)("classifies command error as %s", async (expected, error) => {
    const connection = createADBConnection("192.0.2.10", {
      runCommand: async () => {
        throw error;
      },
    });

    await expect(connection.getReadiness?.()).resolves.toBe(expected);
  });
});
