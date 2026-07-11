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

describe("Android TV ADB application and capture commands", () => {
  test("constructs exact lifecycle and foreground arguments", async () => {
    const calls: string[][] = [];
    const connection = createADBConnection("192.0.2.10", {
      runCommand: async (args) => {
        calls.push(args);
        return args.includes("dumpsys")
          ? "mResumedActivity: ActivityRecord{1 u0 com.example.app/.MainActivity t1}"
          : "";
      },
    });
    await connection.stopApp("com.example.app");
    await connection.launchApp("com.example.app", ".MainActivity");
    expect(await connection.getForegroundApp()).toBe("com.example.app");
    expect(calls).toEqual([
      ["-s", "192.0.2.10:5555", "shell", "am", "force-stop", "com.example.app"],
      ["-s", "192.0.2.10:5555", "shell", "am", "start", "-n", "com.example.app/.MainActivity"],
      ["-s", "192.0.2.10:5555", "shell", "dumpsys", "activity", "activities"],
    ]);
  });

  test("preserves binary PNG bytes from exec-out", async () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 255]);
    let capturedArgs: string[] = [];
    const connection = createADBConnection("192.0.2.10", {
      runCommand: async () => "",
      runBinaryCommand: async (args) => {
        capturedArgs = args;
        return png;
      },
    });
    expect(await connection.captureScreen()).toEqual(png);
    expect(capturedArgs).toEqual(["-s", "192.0.2.10:5555", "exec-out", "screencap", "-p"]);
  });

  test.each([
    "mResumedActivity: ActivityRecord{1 u0 com.example.app/.MainActivity t1}",
    "mCurrentFocus=Window{1 u0 com.example.app/.MainActivity}",
    "mFocusedApp=ActivityRecord{1 u0 com.example.app/.MainActivity t1}",
  ])("parses foreground package from %s", async (output) => {
    const connection = createADBConnection("192.0.2.10", {
      runCommand: async () => output,
    });
    expect(await connection.getForegroundApp()).toBe("com.example.app");
  });
});
