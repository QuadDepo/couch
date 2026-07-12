import { describe, expect, test } from "bun:test";
import type { CouchTestConfig } from "./config";
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

  test("validates optional application and cleanup configuration", () => {
    const config = validateConfig({
      configVersion: 1,
      targets: {
        lab: {
          deviceId: "android-1",
          app: { id: "app", activity: ".Main", artifact: "app.apk" },
          cleanup: "leave-running",
          cleanupTimeoutMs: 5_000,
        },
      },
    });
    expect(config.targets.lab).toMatchObject({
      app: { id: "app", activity: ".Main", artifact: "app.apk" },
      cleanup: "leave-running",
      cleanupTimeoutMs: 5_000,
    });
  });

  test("accepts a webOS application without an Android activity", () => {
    const config = validateConfig({
      configVersion: 1,
      targets: { webos: { deviceId: "webos-1", app: { id: "com.example.app" } } },
    });
    expect(config.targets.webos?.app).toEqual({ id: "com.example.app" });
  });

  test("validates named rendering profiles, regions, masks, and thresholds", () => {
    const input = {
      configVersion: 1,
      targets: {
        lab: {
          deviceId: "android-1",
          app: { id: "app" },
          visualProfile: "android-1080p",
        },
      },
      visualProfiles: {
        "android-1080p": {
          width: 1920,
          height: 1080,
          baselineDirectory: "tests/__screenshots__",
          threshold: 0.2,
          maxDiffRatio: 0.01,
          regions: {
            rail: {
              x: 10,
              y: 20,
              width: 800,
              height: 300,
              ignoreRegions: [{ x: 20, y: 30, width: 10, height: 10 }],
            },
          },
        },
      },
    } satisfies CouchTestConfig;
    const config = validateConfig(input);

    expect(config.visualProfiles?.["android-1080p"]).toMatchObject({
      stableFrames: 2,
      maxAttempts: 5,
      pollIntervalMs: 250,
      regions: { rail: { x: 10, y: 20, width: 800, height: 300 } },
    });
  });

  test.each([
    [{ threshold: 2 }, "between 0 and 1"],
    [{ regions: { rail: { x: 0, y: 0, width: 1921, height: 10 } } }, "fit within"],
    [{ stableFrames: 0 }, "positive integer"],
  ] as const)("rejects invalid rendering profile %#", (override, message) => {
    expect(() =>
      validateConfig({
        configVersion: 1,
        targets: { lab: { deviceId: "android-1", app: { id: "app" } } },
        visualProfiles: {
          profile: {
            width: 1920,
            height: 1080,
            baselineDirectory: "baselines",
            regions: { rail: { x: 0, y: 0, width: 100, height: 100 } },
            ...override,
          },
        },
      }),
    ).toThrow(message);
  });

  test.each([
    "../outside",
    "nested/profile",
    "nested\\profile",
    "/absolute",
  ])("rejects path-like visual profile name %s", (profileName) => {
    expect(() =>
      validateConfig({
        configVersion: 1,
        targets: { lab: { deviceId: "android-1", app: { id: "app" } } },
        visualProfiles: {
          [profileName]: {
            width: 10,
            height: 10,
            baselineDirectory: "baselines",
            regions: { rail: { x: 0, y: 0, width: 1, height: 1 } },
          },
        },
      }),
    ).toThrow("is invalid");
  });

  test.each([
    [{ height: 10 }, "width"],
    [{ width: 10 }, "height"],
    [{ width: 0, height: 10 }, "width"],
    [{ width: 10, height: 0 }, "height"],
    [{ width: 10, height: 10, regions: { rail: { x: 0, y: 0, height: 1 } } }, "width"],
    [{ width: 10, height: 10, regions: { rail: { x: 0, y: 0, width: 1 } } }, "height"],
  ] as const)("rejects missing or zero visual dimensions %#", (profile, field) => {
    expect(() =>
      validateConfig({
        configVersion: 1,
        targets: { lab: { deviceId: "android-1", app: { id: "app" } } },
        visualProfiles: {
          profile: {
            baselineDirectory: "baselines",
            regions: { rail: { x: 0, y: 0, width: 1, height: 1 } },
            ...profile,
          },
        },
      }),
    ).toThrow(field);
  });
});
