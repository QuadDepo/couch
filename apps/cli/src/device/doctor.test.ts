import { describe, expect, test } from "bun:test";
import type { DeviceInventory, OperationCapability } from "@couch/device";
import { runCli } from "../cli";
import { output } from "../testSupport/fakes";

function inventory(capability: OperationCapability): DeviceInventory {
  return {
    listDevices: async () => [],
    getDevice: async () => ({
      id: "lab",
      name: "Lab",
      platform: "webos",
      ip: "192.0.2.2",
      driverId: "lg-ssap",
    }),
    getCapabilities: async () => new Map([["control.press", capability]]),
    openSession: async () => {
      throw new Error("doctor must not open a session");
    },
  };
}

describe("device doctor", () => {
  test("reports live readiness", async () => {
    const result = output();
    const exit = await runCli(["device", "doctor", "lab", "--json"], {
      createInventory: () =>
        inventory({
          support: "stable",
          readiness: "ready",
          constraints: { readinessCheck: "live-adb-probe" },
        }),
      stdout: result.writeOut,
      stderr: result.writeErr,
    });
    expect(exit).toBe(0);
    expect(JSON.parse(result.stdout[0] ?? "")).toMatchObject({
      command: "device.doctor",
      status: "ready",
      readinessScope: "live",
      capabilities: [{ remediation: "None." }],
    });
  });

  test("reports configuration-only readiness as unverified", async () => {
    const result = output();
    const exit = await runCli(["device", "doctor", "lab", "--json"], {
      createInventory: () =>
        inventory({
          support: "stable",
          readiness: "ready",
          constraints: { readinessCheck: "paired-configuration-only" },
        }),
      stdout: result.writeOut,
      stderr: result.writeErr,
    });
    expect(exit).toBe(2);
    expect(JSON.parse(result.stdout[0] ?? "")).toMatchObject({
      status: "unverified",
      readinessScope: "configuration-only",
      error: { code: "live-readiness-unverified" },
      capabilities: [
        {
          remediation:
            "Live connectivity was not checked; run `couch remote press lab LEFT` to verify control.",
        },
      ],
    });
  });

  test("prioritizes readiness remediation", async () => {
    const result = output();
    await runCli(["device", "doctor", "lab"], {
      createInventory: () =>
        inventory({
          support: "stable",
          readiness: "missing-tool",
          reason: "ADB missing",
          constraints: { readinessCheck: "live-adb-probe" },
        }),
      stdout: result.writeOut,
      stderr: result.writeErr,
    });
    expect(result.stdout[0]).toContain("control.press\tstable\tmissing-tool");
    expect(result.stdout[0]).toContain("Install the required device tool");
    expect(result.stderr[0]).toContain("target-not-ready");
  });

  test("flags experimental capabilities as not-ready", async () => {
    const result = output();
    const exit = await runCli(["device", "doctor", "lab", "--json"], {
      createInventory: () =>
        inventory({
          support: "experimental",
          readiness: "ready",
          constraints: { readinessCheck: "live-adb-probe" },
        }),
      stdout: result.writeOut,
      stderr: result.writeErr,
    });
    expect(exit).toBe(2);
    expect(JSON.parse(result.stdout[0] ?? "")).toMatchObject({
      status: "not-ready",
      capabilities: [
        { remediation: "Explicitly allow this experimental operation for the target before use." },
      ],
    });
  });

  test("prioritizes experimental approval for configuration-only capture", async () => {
    const result = output();
    await runCli(["device", "doctor", "lab", "--json"], {
      createInventory: () =>
        inventory({
          support: "experimental",
          readiness: "ready",
          constraints: { readinessCheck: "paired-configuration-only" },
        }),
      stdout: result.writeOut,
      stderr: result.writeErr,
    });
    expect(JSON.parse(result.stdout[0] ?? "").capabilities[0].remediation).toBe(
      "Explicitly allow this experimental operation for the target before use.",
    );
  });
});
