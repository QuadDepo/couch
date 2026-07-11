import { describe, expect, test } from "bun:test";
import { type DeviceInventory, DeviceInventoryError, type DeviceSession } from "@couch/device";
import type { CouchTestConfig } from "@couch/runner/config";
import { runCli } from "../cli";
import { operationRecord, output, signalTarget } from "../testSupport/fakes";

function config(allowExperimental = false): CouchTestConfig {
  return {
    configVersion: 1,
    targets: {
      webos: {
        deviceId: "webos-1",
        app: { id: "com.example.app" },
        ...(allowExperimental ? { allowExperimental: ["screen.capture"] } : {}),
      },
    },
  };
}

function inventory(executed: string[]): DeviceInventory {
  const session: DeviceSession = {
    capabilities: new Map(),
    execute: async (operation) => {
      executed.push(operation.kind === "screen.capture" ? (operation.path ?? "") : "");
      return operationRecord(operation, "succeeded");
    },
    close: async () => undefined,
  };
  return {
    listDevices: async () => [],
    getDevice: async () => ({
      id: "webos-1",
      name: "LG Lab",
      platform: "webos",
      ip: "192.0.2.20",
      driverId: "lg-ssap",
    }),
    getCapabilities: async () => new Map(),
    openSession: async (_id, options) => {
      if (!options.allowExperimental?.includes("screen.capture")) {
        throw new DeviceInventoryError(
          "EXPERIMENTAL_OPERATION",
          "screen.capture requires explicit target approval for webos-1",
          "unsupported",
        );
      }
      return session;
    },
  };
}

describe("webOS screenshot CLI", () => {
  test.each([
    [false, 2, 0],
    [true, 0, 1],
  ] as const)("experimental approval=%s exits %i", async (allowed, exitCode, count) => {
    const executed: string[] = [];
    const io = output();
    expect(
      await runCli(["screenshot", "webos", "--out", "actual.jpg", "--json"], {
        createInventory: () => inventory(executed),
        loadConfig: async () => config(allowed),
        signalTarget: signalTarget(),
        stdout: io.writeOut,
        stderr: io.writeErr,
      }),
    ).toBe(exitCode);
    expect(executed).toHaveLength(count);
  });

  test("rejects a misleading PNG extension before opening the session", async () => {
    let opened = false;
    const value = inventory([]);
    value.openSession = async () => {
      opened = true;
      throw new Error("unexpected");
    };
    const io = output();
    expect(
      await runCli(["screenshot", "webos", "--out", "actual.png", "--json"], {
        createInventory: () => value,
        loadConfig: async () => config(true),
        signalTarget: signalTarget(),
        stdout: io.writeOut,
        stderr: io.writeErr,
      }),
    ).toBe(2);
    expect(opened).toBe(false);
    expect(io.stderr.join(" ")).toContain(".jpg or .jpeg");
  });
});
