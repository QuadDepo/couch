import { describe, expect, test } from "bun:test";
import type { DeviceInventory } from "@couch/device";
import { runCli } from "../cli";
import { output, signalTarget, waitForAbort } from "../testSupport/fakes";

describe("device command cancellation", () => {
  test.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)("cancels inventory listing with %s", async (signal, expectedExit) => {
    const result = output();
    const signals = signalTarget();
    let started!: () => void;
    const loading = new Promise<void>((resolve) => {
      started = resolve;
    });
    const inventory: DeviceInventory = {
      listDevices: async (options) => {
        started();
        return waitForAbort(options?.signal);
      },
      getDevice: async () => {
        throw new Error("unreachable");
      },
      getCapabilities: async () => new Map(),
      openSession: async () => {
        throw new Error("unreachable");
      },
    };
    const command = runCli(["device", "list", "--json"], {
      createInventory: () => inventory,
      stdout: result.writeOut,
      stderr: result.writeErr,
      signalTarget: signals,
    });
    await loading;
    signals.emit(signal);
    expect(await command).toBe(expectedExit);
    expect(signals.removed).toEqual(["SIGINT", "SIGTERM"]);
    expect(JSON.parse(result.stdout[0] ?? "")).toMatchObject({
      command: "device.list",
      status: "cancelled",
      exitCode: expectedExit,
    });
  });

  test("cancels doctor capability inspection without opening a session", async () => {
    const result = output();
    const signals = signalTarget();
    let opened = false;
    const inventory: DeviceInventory = {
      listDevices: async () => [],
      getDevice: async () => ({ id: "lab", name: "Lab", platform: "android-tv", ip: "127.0.0.1" }),
      getCapabilities: async (_id, options) => {
        signals.emit("SIGINT");
        return waitForAbort(options?.signal);
      },
      openSession: async () => {
        opened = true;
        throw new Error("unreachable");
      },
    };
    const exit = await runCli(["device", "doctor", "lab", "--json"], {
      createInventory: () => inventory,
      stdout: result.writeOut,
      stderr: result.writeErr,
      signalTarget: signals,
    });
    expect(exit).toBe(130);
    expect(opened).toBe(false);
    expect(JSON.parse(result.stdout[0] ?? "")).toMatchObject({
      command: "device.doctor",
      status: "cancelled",
      error: { code: "cancelled" },
    });
  });
});
