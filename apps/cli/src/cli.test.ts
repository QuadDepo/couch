import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  DeviceDescriptor,
  DeviceHarness,
  DeviceRuntime,
  DeviceRuntimeOptions,
  DiagnosticEvent,
  OperationRecord,
  RemoteKey,
} from "@couch/device";
import { createDeviceRuntime } from "../../../packages/device/src/runtime/deviceRuntime";
import { runCli } from "./cli";

function record(ordinal: number, status: OperationRecord["status"] = "succeeded"): OperationRecord {
  return {
    id: `operation-${ordinal}`,
    ordinal,
    kind: "control.press",
    adapterId: "fake",
    status,
    ...(status === "succeeded" ? { confirmation: "process-exit" as const } : {}),
    startedAt: `2026-01-01T00:00:0${ordinal}.000Z`,
    completedAt: `2026-01-01T00:00:0${ordinal}.100Z`,
    input: { key: "LEFT" },
    ...(status === "succeeded"
      ? {}
      : {
          error: {
            code: status === "cancelled" ? "cancelled" : "driver-failed",
            category: status === "cancelled" ? ("cancelled" as const) : ("infrastructure" as const),
            message: status === "cancelled" ? "cancelled" : "driver failed",
            retryable: false,
          },
        }),
    artifacts: [],
  };
}

interface FakeSignalTarget {
  handlers: Partial<Record<"SIGINT" | "SIGTERM", () => void>>;
  added: string[];
  removed: string[];
  on(signal: "SIGINT" | "SIGTERM", listener: () => void): void;
  removeListener(signal: "SIGINT" | "SIGTERM", listener: () => void): void;
  emit(signal: "SIGINT" | "SIGTERM"): void;
}

function signalTarget(): FakeSignalTarget {
  return {
    handlers: {},
    added: [],
    removed: [],
    on(signal, listener) {
      this.handlers[signal] = listener;
      this.added.push(signal);
    },
    removeListener(signal) {
      delete this.handlers[signal];
      this.removed.push(signal);
    },
    emit(signal) {
      this.handlers[signal]?.();
    },
  };
}

function runtimeWithHarness(harness: DeviceHarness): DeviceRuntime {
  return {
    getDevice: async () => ({ id: "lab", name: "Lab", platform: "android-tv", ip: "127.0.0.1" }),
    getCapabilities: async () => new Map(),
    openDevice: async () => harness,
  };
}

function output() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    writeOut: (text: string) => stdout.push(text),
    writeErr: (text: string) => stderr.push(text),
  };
}

describe("remote press CLI", () => {
  test("serializes a successful sequence as JSON", async () => {
    const outputs = output();
    const calls: RemoteKey[] = [];
    let active = 0;
    let maxActive = 0;
    const harness: DeviceHarness = {
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
      createRuntime: () => runtimeWithHarness(harness),
      stdout: outputs.writeOut,
      stderr: outputs.writeErr,
    });

    expect(exit).toBe(0);
    expect(calls).toEqual(["LEFT", "LEFT", "LEFT"]);
    expect(maxActive).toBe(1);
    expect(JSON.parse(outputs.stdout[0] ?? "")).toEqual({
      resultVersion: 1,
      command: "remote.press",
      targetId: "lab",
      key: "LEFT",
      requestedTimes: 3,
      status: "succeeded",
      exitCode: 0,
      operations: [record(1), record(2), record(3)],
    });
    expect(outputs.stderr).toEqual([]);
  });

  test("stops after the first failed operation", async () => {
    const outputs = output();
    const calls: number[] = [];
    const harness: DeviceHarness = {
      capabilities: new Map(),
      execute: async () => {
        calls.push(1);
        return record(calls.length, calls.length === 1 ? "failed" : "succeeded");
      },
      close: async () => undefined,
    };

    const exit = await runCli(["remote", "press", "lab", "LEFT", "--times", "3", "--json"], {
      createRuntime: () => runtimeWithHarness(harness),
      stdout: outputs.writeOut,
      stderr: outputs.writeErr,
    });

    expect(exit).toBe(2);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(outputs.stdout[0] ?? "").operations).toHaveLength(1);
    expect(outputs.stderr[0]).toContain("driver-failed");
  });

  test("keeps diagnostics off stdout", async () => {
    const outputs = output();
    const harness: DeviceHarness = {
      capabilities: new Map(),
      execute: async () => record(1, "failed"),
      close: async () => undefined,
    };

    const exit = await runCli(["remote", "press", "lab", "LEFT"], {
      createRuntime: () => runtimeWithHarness(harness),
      stdout: outputs.writeOut,
      stderr: outputs.writeErr,
    });

    expect(exit).toBe(2);
    expect(outputs.stdout[0]).toBe("1/1 LEFT failed\nremote.press lab: failed (1/1)\n");
    expect(outputs.stdout[0]).not.toContain("driver-failed");
    expect(outputs.stderr[0]).toContain("driver-failed");
  });

  test("routes runtime diagnostics to stderr", async () => {
    const outputs = output();
    const harness: DeviceHarness = {
      capabilities: new Map(),
      execute: async () => record(1),
      close: async () => undefined,
    };
    const diagnostic: DiagnosticEvent = {
      level: "info",
      message: "Device opened",
      at: "2026-01-01T00:00:00.000Z",
    };

    const exit = await runCli(["remote", "press", "lab", "LEFT"], {
      createRuntime: (options) => {
        const sink = options?.diagnosticSink;
        if (typeof sink === "function") void sink(diagnostic);
        return runtimeWithHarness(harness);
      },
      stdout: outputs.writeOut,
      stderr: outputs.writeErr,
    });

    expect(exit).toBe(0);
    expect(outputs.stdout.join("")).not.toContain("Device opened");
    expect(outputs.stderr).toEqual(["info: Device opened\n"]);
  });

  test("turns synchronous runtime creation failures into structured results", async () => {
    const outputs = output();

    const exit = await runCli(["remote", "press", "lab", "LEFT", "--json"], {
      createRuntime: () => {
        throw new Error("inventory unavailable");
      },
      stdout: outputs.writeOut,
      stderr: outputs.writeErr,
    });

    expect(exit).toBe(2);
    expect(JSON.parse(outputs.stdout[0] ?? "")).toMatchObject({
      resultVersion: 1,
      command: "remote.press",
      targetId: "lab",
      status: "failed",
      exitCode: 2,
      error: { code: "runtime-failed", message: "inventory unavailable" },
    });
  });

  test("installs signal handlers before open and closes on interrupt", async () => {
    const outputs = output();
    const signals = signalTarget();
    let closeCount = 0;
    let opened = false;
    const harness: DeviceHarness = {
      capabilities: new Map(),
      execute: async () => record(1, "cancelled"),
      close: async () => {
        closeCount += 1;
      },
    };
    const runtime: DeviceRuntime = {
      ...runtimeWithHarness(harness),
      openDevice: async (_id, options) => {
        expect(signals.added).toEqual(["SIGINT", "SIGTERM"]);
        opened = true;
        signals.emit("SIGINT");
        expect(options.signal?.aborted).toBe(true);
        return harness;
      },
    };

    const exit = await runCli(["remote", "press", "lab", "LEFT", "--json"], {
      createRuntime: () => runtime,
      stdout: outputs.writeOut,
      stderr: outputs.writeErr,
      signalTarget: signals,
    });

    expect(opened).toBe(true);
    expect(exit).toBe(130);
    expect(closeCount).toBe(1);
    expect(signals.removed).toEqual(["SIGINT", "SIGTERM"]);
  });

  test("maps SIGTERM to its conventional exit code", async () => {
    const outputs = output();
    const signals = signalTarget();
    const harness: DeviceHarness = {
      capabilities: new Map(),
      execute: async () => record(1, "cancelled"),
      close: async () => undefined,
    };
    const runtime: DeviceRuntime = {
      ...runtimeWithHarness(harness),
      openDevice: async () => {
        signals.emit("SIGTERM");
        return harness;
      },
    };

    const exit = await runCli(["remote", "press", "lab", "LEFT"], {
      createRuntime: () => runtime,
      stdout: outputs.writeOut,
      stderr: outputs.writeErr,
      signalTarget: signals,
    });

    expect(exit).toBe(143);
  });

  test("returns stable help and usage errors", async () => {
    const help = output();
    expect(await runCli(["--help"], { stdout: help.writeOut, stderr: help.writeErr })).toBe(0);
    expect(help.stdout[0]).toContain("Usage: couch remote press");

    const commandHelp = output();
    expect(
      await runCli(["remote", "press", "--help"], {
        stdout: commandHelp.writeOut,
        stderr: commandHelp.writeErr,
      }),
    ).toBe(0);
    expect(commandHelp.stdout[0]).toContain("Usage: couch remote press");

    const invalid = output();
    expect(
      await runCli(["remote", "press", "lab", "NOPE"], {
        stdout: invalid.writeOut,
        stderr: invalid.writeErr,
      }),
    ).toBe(64);
    expect(invalid.stdout).toEqual([]);
    expect(invalid.stderr[0]).toContain("unknown remote key");
  });

  test("releases the real device lock immediately after SIGINT", async () => {
    const lockDirectory = await mkdtemp(join(tmpdir(), "couch-cli-lock-"));
    const signals = signalTarget();
    let started!: () => void;
    const operationStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const registry: NonNullable<DeviceRuntimeOptions["registry"]> = {
      getRegistration: () => ({
        driverId: "test-driver",
        platform: "android-tv",
        getCapabilities: () =>
          new Map([["control.press", { support: "stable" as const, readiness: "ready" as const }]]),
        lockResourceId: () => "test-device:lab",
        createDriver: () => ({
          adapterId: "test-driver",
          open: () => undefined,
          isReady: () => true,
          execute: async (_operation, options = {}) => {
            started();
            await new Promise<void>((_resolve, reject) => {
              const abort = () => reject(options.signal?.reason);
              if (options.signal?.aborted) abort();
              else options.signal?.addEventListener("abort", abort, { once: true });
            });
            return { confirmation: "process-exit" };
          },
          close: () => undefined,
        }),
      }),
    };
    const device = {
      id: "lab",
      name: "Lab",
      platform: "android-tv",
      ip: "127.0.0.1",
      driverId: "test-driver",
    } satisfies DeviceDescriptor;
    const runtimeOptions: DeviceRuntimeOptions = {
      inventoryLoader: () => [device],
      registry,
      lockDirectory,
    };

    try {
      const firstRuntime = createDeviceRuntime(runtimeOptions);
      const command = runCli(["remote", "press", "lab", "LEFT", "--json"], {
        createRuntime: () => firstRuntime,
        stdout: () => undefined,
        stderr: () => undefined,
        signalTarget: signals,
      });
      await operationStarted;
      signals.emit("SIGINT");
      expect(await command).toBe(130);

      const secondRuntime = createDeviceRuntime(runtimeOptions);
      const secondHarness = await secondRuntime.openDevice("lab", {
        require: ["control.press"],
      });
      await secondHarness.close();
    } finally {
      await rm(lockDirectory, { recursive: true, force: true });
    }
  });
});
