import { describe, expect, test } from "bun:test";
import type { DeviceSession, DiagnosticEvent, RemoteKey } from "@couch/device";
import { runCli } from "../cli";
import { inventoryWithSession, output, record } from "../testSupport/fakes";

describe("remote press", () => {
  test("serializes a successful sequence as JSON", async () => {
    const result = output();
    const calls: RemoteKey[] = [];
    let active = 0;
    let maxActive = 0;
    const session: DeviceSession = {
      capabilities: new Map(),
      execute: async (operation) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        if (operation.kind === "control.press") calls.push(operation.key);
        await Promise.resolve();
        active -= 1;
        return record(calls.length);
      },
      close: async () => undefined,
    };
    const exit = await runCli(["remote", "press", "lab", "LEFT", "--times", "3", "--json"], {
      createInventory: () => inventoryWithSession(session),
      stdout: result.writeOut,
      stderr: result.writeErr,
    });
    expect(exit).toBe(0);
    expect(calls).toEqual(["LEFT", "LEFT", "LEFT"]);
    expect(maxActive).toBe(1);
    expect(JSON.parse(result.stdout[0] ?? "")).toMatchObject({
      command: "remote.press",
      status: "succeeded",
      operations: [record(1), record(2), record(3)],
    });
  });

  test("stops after the first failed operation", async () => {
    const result = output();
    let calls = 0;
    const session: DeviceSession = {
      capabilities: new Map(),
      execute: async () => record(++calls, "failed"),
      close: async () => undefined,
    };
    const exit = await runCli(["remote", "press", "lab", "LEFT", "--times", "3"], {
      createInventory: () => inventoryWithSession(session),
      stdout: result.writeOut,
      stderr: result.writeErr,
    });
    expect(exit).toBe(2);
    expect(calls).toBe(1);
    expect(result.stdout[0]).toBe("1/3 LEFT failed\nremote.press lab: failed (1/3)\n");
    expect(result.stderr[0]).toContain("driver-failed");
  });

  test("routes inventory diagnostics to stderr", async () => {
    const result = output();
    const diagnostic: DiagnosticEvent = {
      level: "info",
      message: "Device opened",
      at: "2026-01-01T00:00:00.000Z",
    };
    const session: DeviceSession = {
      capabilities: new Map(),
      execute: async () => record(1),
      close: async () => undefined,
    };
    await runCli(["remote", "press", "lab", "LEFT"], {
      createInventory: (options) => {
        const sink = options?.diagnosticSink;
        if (typeof sink === "function") void sink(diagnostic);
        return inventoryWithSession(session);
      },
      stdout: result.writeOut,
      stderr: result.writeErr,
    });
    expect(result.stdout.join("")).not.toContain("Device opened");
    expect(result.stderr).toEqual(["info: Device opened\n"]);
  });

  test("reports creation failures as structured results", async () => {
    const result = output();
    const exit = await runCli(["remote", "press", "lab", "LEFT", "--json"], {
      createInventory: () => {
        throw new Error("inventory unavailable");
      },
      stdout: result.writeOut,
      stderr: result.writeErr,
    });
    expect(exit).toBe(2);
    expect(JSON.parse(result.stdout[0] ?? "")).toMatchObject({
      status: "failed",
      error: { code: "runtime-failed", message: "inventory unavailable" },
    });
  });
});
