import { describe, expect, test } from "bun:test";
import type { DeviceInventory, DeviceSession } from "@couch/device";
import { runCli } from "../cli";
import { output, record, signalTarget, waitForAbort } from "../testSupport/fakes";

describe("remote press cancellation", () => {
  test.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)("maps %s and closes the session once", async (signal, expectedExit) => {
    const result = output();
    const signals = signalTarget();
    let closeCount = 0;
    const session: DeviceSession = {
      capabilities: new Map(),
      execute: async () => record(1, "cancelled"),
      close: async () => {
        closeCount += 1;
      },
    };
    const inventory: DeviceInventory = {
      listDevices: async () => [],
      getDevice: async () => ({ id: "lab", name: "Lab", platform: "android-tv", ip: "127.0.0.1" }),
      getCapabilities: async () => new Map(),
      openSession: async (_id, options) => {
        expect(signals.added).toEqual(["SIGINT", "SIGTERM"]);
        signals.emit(signal);
        expect(options.signal?.aborted).toBe(true);
        return session;
      },
    };
    const exit = await runCli(["remote", "press", "lab", "LEFT", "--json"], {
      createInventory: () => inventory,
      stdout: result.writeOut,
      stderr: result.writeErr,
      signalTarget: signals,
    });
    expect(exit).toBe(expectedExit);
    expect(closeCount).toBe(1);
    expect(signals.removed).toEqual(["SIGINT", "SIGTERM"]);
    expect(JSON.parse(result.stdout[0] ?? "")).toMatchObject({
      status: "cancelled",
      exitCode: expectedExit,
      error: { code: "cancelled" },
    });
  });

  test("cancels a capability probe that honors AbortSignal", async () => {
    const result = output();
    const signals = signalTarget();
    let started!: () => void;
    const probeStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const inventory: DeviceInventory = {
      listDevices: async () => [],
      getDevice: async () => ({ id: "lab", name: "Lab", platform: "android-tv", ip: "127.0.0.1" }),
      getCapabilities: async () => new Map(),
      openSession: async (_id, options) => {
        started();
        return await waitForAbort(options.signal);
      },
    };
    const command = runCli(["remote", "press", "lab", "LEFT", "--json"], {
      createInventory: () => inventory,
      stdout: result.writeOut,
      stderr: result.writeErr,
      signalTarget: signals,
    });
    await probeStarted;
    signals.emit("SIGINT");
    expect(await command).toBe(130);
    expect(JSON.parse(result.stdout[0] ?? "")).toMatchObject({
      status: "cancelled",
      operations: [],
    });
  });

  test("reports close failures without hiding cancellation", async () => {
    const result = output();
    const signals = signalTarget();
    const session: DeviceSession = {
      capabilities: new Map(),
      execute: async () => {
        signals.emit("SIGTERM");
        return record(1, "cancelled");
      },
      close: async () => {
        throw new Error("close failed");
      },
    };
    const inventory: DeviceInventory = {
      listDevices: async () => [],
      getDevice: async () => ({ id: "lab", name: "Lab", platform: "android-tv", ip: "127.0.0.1" }),
      getCapabilities: async () => new Map(),
      openSession: async () => session,
    };
    const exit = await runCli(["remote", "press", "lab", "LEFT", "--json"], {
      createInventory: () => inventory,
      stdout: result.writeOut,
      stderr: result.writeErr,
      signalTarget: signals,
    });
    expect(exit).toBe(143);
    expect(JSON.parse(result.stdout[0] ?? "")).toMatchObject({
      status: "cancelled",
      cleanupError: { message: "close failed" },
    });
  });
});
