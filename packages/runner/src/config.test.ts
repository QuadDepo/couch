import { describe, expect, test } from "bun:test";
import { resolveTarget, validateConfig } from "./config";

describe("runner config", () => {
  test("resolves a stable alias with explicit Android application configuration", () => {
    const config = validateConfig({
      configVersion: 1,
      targets: {
        lab: { deviceId: "android-1", app: { id: "com.example.app", activity: ".Main" } },
      },
    });
    expect(resolveTarget(config, "lab").deviceId).toBe("android-1");
  });

  test("rejects credentials and physical addresses in project config", () => {
    expect(() =>
      validateConfig({
        configVersion: 1,
        targets: {
          lab: {
            deviceId: "android-1",
            app: { id: "com.example.app", activity: ".Main" },
            credentials: { token: "secret" },
          },
        },
      }),
    ).toThrow("must not contain device credentials");
  });

  test.each([
    [{ cleanup: "remove" }, "cleanup policy"],
    [{ operationTimeoutMs: 0 }, "positive finite"],
    [{ foregroundTimeoutMs: Number.POSITIVE_INFINITY }, "positive finite"],
    [{ cleanupTimeoutMs: -1 }, "positive finite"],
    [{ allowExperimental: ["unknown.operation"] }, "allowExperimental operation"],
    [{ deviceIp: "192.0.2.1" }, "device credentials"],
  ] as const)("rejects invalid target option %#", (targetOption, message) => {
    expect(() =>
      validateConfig({
        configVersion: 1,
        targets: {
          lab: {
            deviceId: "android-1",
            app: { id: "com.example.app", activity: ".Main" },
            ...targetOption,
          },
        },
      }),
    ).toThrow(message);
  });

  test("rejects dot-segment aliases and unknown app fields", () => {
    expect(() =>
      validateConfig({
        configVersion: 1,
        targets: {
          "..": { deviceId: "android-1", app: { id: "app", activity: ".Main" } },
        },
      }),
    ).toThrow("Invalid target alias");
    expect(() =>
      validateConfig({
        configVersion: 1,
        targets: {
          lab: {
            deviceId: "android-1",
            app: { id: "app", activity: ".Main", tokenValue: "secret" },
          },
        },
      }),
    ).toThrow("device credentials");
  });

  test("validates optional adapter and rendering configuration", () => {
    const config = validateConfig({
      configVersion: 1,
      targets: {
        lab: {
          deviceId: "android-1",
          app: { id: "app", activity: ".Main", artifact: "app.apk" },
          adapters: { control: "adb", lifecycle: "adb", observation: "adb" },
          renderingProfile: "android-1080p",
          cleanup: "leave-running",
          cleanupTimeoutMs: 5_000,
        },
      },
    });
    expect(config.targets.lab).toMatchObject({
      adapters: { control: "adb", lifecycle: "adb", observation: "adb" },
      renderingProfile: "android-1080p",
      cleanupTimeoutMs: 5_000,
    });
  });
});
