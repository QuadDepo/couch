import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
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
    listDevices: async () => [],
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

function credentialBearingDescriptor(overrides: Partial<DeviceDescriptor> = {}): DeviceDescriptor {
  return {
    id: "webos-lab",
    name: "webOS Lab",
    platform: "webos",
    ip: "192.168.1.20",
    driverId: "lg-ssap",
    metadata: {
      pairing: { clientKey: "nested-client-secret" },
      privateKey: "nested-private-secret",
      token: "nested-token-secret",
      certificates: ["nested-certificate-secret"],
    },
    config: { webos: { clientKey: "config-client-secret" } },
    source: { config: { privateKey: "source-private-secret" } },
    ...overrides,
  } as DeviceDescriptor;
}

function expectCredentialSafeJson(json: string): void {
  for (const key of [
    "metadata",
    "config",
    "source",
    "clientKey",
    "privateKey",
    "token",
    "certificates",
  ]) {
    expect(json).not.toContain(`"${key}"`);
  }
  expect(json).not.toContain("nested-client-secret");
  expect(json).not.toContain("nested-private-secret");
  expect(json).not.toContain("nested-token-secret");
  expect(json).not.toContain("nested-certificate-secret");
  expect(json).not.toContain("config-client-secret");
  expect(json).not.toContain("source-private-secret");
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

  test.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)("cancels remote press with %s while capability probing never settles", async (signal, expectedExit) => {
    const outputs = output();
    const signals = signalTarget();
    const directory = await mkdtemp(join(tmpdir(), "couch-cli-probe-"));
    const lockDirectory = join(directory, "locks");
    let probeStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      probeStarted = resolve;
    });
    let driverCreations = 0;
    let driverOpens = 0;
    const runtime = createDeviceRuntime({
      inventoryLoader: () => [
        {
          id: "lab",
          name: "Lab",
          platform: "android-tv",
          ip: "127.0.0.1",
          driverId: "stalled-driver",
        } satisfies DeviceDescriptor,
      ],
      registry: {
        getRegistration: () => ({
          driverId: "stalled-driver",
          platform: "android-tv",
          getCapabilities: () => {
            probeStarted();
            return new Promise(() => undefined);
          },
          createDriver: () => {
            driverCreations += 1;
            return {
              adapterId: "stalled-driver",
              open: () => {
                driverOpens += 1;
              },
              isReady: () => true,
              execute: async () => ({ confirmation: "process-exit" }),
              close: () => undefined,
            };
          },
        }),
      },
      lockDirectory,
    });

    try {
      const command = runCli(["remote", "press", "lab", "LEFT", "--json"], {
        createRuntime: () => runtime,
        stdout: outputs.writeOut,
        stderr: outputs.writeErr,
        signalTarget: signals,
      });
      await started;
      signals.emit(signal);

      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const exit = await Promise.race([
          command,
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => reject(new Error("remote press remained hung")), 500);
          }),
        ]);
        expect(exit).toBe(expectedExit);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
      expect(outputs.stdout).toHaveLength(1);
      expect(JSON.parse(outputs.stdout[0] ?? "")).toMatchObject({
        command: "remote.press",
        status: "cancelled",
        exitCode: expectedExit,
        error: { code: "cancelled" },
        operations: [],
      });
      expect(signals.removed).toEqual(["SIGINT", "SIGTERM"]);
      expect(driverCreations).toBe(0);
      expect(driverOpens).toBe(0);
      await expect(stat(lockDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  test("returns stable help and usage errors", async () => {
    const help = output();
    expect(await runCli(["--help"], { stdout: help.writeOut, stderr: help.writeErr })).toBe(0);
    expect(help.stdout[0]).toContain("couch remote press");

    const commandHelp = output();
    expect(
      await runCli(["remote", "press", "--help"], {
        stdout: commandHelp.writeOut,
        stderr: commandHelp.writeErr,
      }),
    ).toBe(0);
    expect(commandHelp.stdout[0]).toContain("couch remote press");

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

describe("device CLI", () => {
  test("lists credential-safe descriptors as one sorted JSON document", async () => {
    const outputs = output();
    const runtime: DeviceRuntime = {
      ...runtimeWithHarness({
        capabilities: new Map(),
        execute: async () => record(1),
        close: async () => undefined,
      }),
      listDevices: async () => [
        credentialBearingDescriptor(),
        {
          id: "android-lab",
          name: "Android Lab",
          platform: "android-tv",
          ip: "192.168.1.10",
          driverId: "adb",
        },
      ],
    };

    const exit = await runCli(["device", "list", "--json"], {
      createRuntime: () => runtime,
      stdout: outputs.writeOut,
      stderr: outputs.writeErr,
    });

    expect(exit).toBe(0);
    expect(outputs.stdout).toHaveLength(1);
    expect(JSON.parse(outputs.stdout[0] ?? "")).toEqual({
      resultVersion: 1,
      command: "device.list",
      status: "succeeded",
      exitCode: 0,
      devices: [
        {
          id: "android-lab",
          name: "Android Lab",
          platform: "android-tv",
          ip: "192.168.1.10",
          driverId: "adb",
        },
        {
          id: "webos-lab",
          name: "webOS Lab",
          platform: "webos",
          ip: "192.168.1.20",
          driverId: "lg-ssap",
        },
      ],
    });
    expectCredentialSafeJson(outputs.stdout[0] ?? "");
    expect(outputs.stderr).toEqual([]);
  });

  test("prints a stable human device table", async () => {
    const outputs = output();
    const runtime: DeviceRuntime = {
      ...runtimeWithHarness({
        capabilities: new Map(),
        execute: async () => record(1),
        close: async () => undefined,
      }),
      listDevices: async () => [
        {
          id: "lab",
          name: "Living Room",
          platform: "webos",
          ip: "192.168.1.20",
          driverId: "lg-ssap",
        },
      ],
    };

    expect(
      await runCli(["device", "list"], {
        createRuntime: () => runtime,
        stdout: outputs.writeOut,
        stderr: outputs.writeErr,
      }),
    ).toBe(0);
    expect(outputs.stdout[0]).toBe(
      "ID\tNAME\tPLATFORM\tDRIVER\tADDRESS\nlab\tLiving Room\twebos\tlg-ssap\t192.168.1.20\n",
    );
  });

  test("reports webOS configuration-only readiness without opening a harness", async () => {
    const outputs = output();
    let opens = 0;
    const runtime: DeviceRuntime = {
      listDevices: async () => [],
      getDevice: async () => credentialBearingDescriptor(),
      getCapabilities: async () =>
        new Map([
          [
            "control.press",
            {
              support: "stable",
              readiness: "ready",
              reason: "Paired client key configured; live connectivity was not checked",
              constraints: { readinessCheck: "paired-configuration-only" },
            },
          ],
        ]),
      openDevice: async () => {
        opens += 1;
        throw new Error("doctor must not open a harness");
      },
    };

    const exit = await runCli(["device", "doctor", "webos-lab", "--json"], {
      createRuntime: () => runtime,
      stdout: outputs.writeOut,
      stderr: outputs.writeErr,
    });

    expect(exit).toBe(2);
    expect(opens).toBe(0);
    expect(outputs.stdout).toHaveLength(1);
    expect(JSON.parse(outputs.stdout[0] ?? "")).toMatchObject({
      resultVersion: 1,
      command: "device.doctor",
      targetId: "webos-lab",
      status: "unverified",
      exitCode: 2,
      readinessScope: "configuration-only",
      capabilities: [
        {
          kind: "control.press",
          support: "stable",
          readiness: "ready",
          constraints: { readinessCheck: "paired-configuration-only" },
          remediation:
            "Live connectivity was not checked; run `couch remote press webos-lab LEFT` to verify control.",
        },
      ],
    });
    expectCredentialSafeJson(outputs.stdout[0] ?? "");
  });

  test("returns infrastructure failure and remediation for a missing tool", async () => {
    const outputs = output();
    let receivedSignal: AbortSignal | undefined;
    const runtime: DeviceRuntime = {
      listDevices: async () => [],
      getDevice: async () => ({
        id: "android-lab",
        name: "Android Lab",
        platform: "android-tv",
        ip: "192.168.1.10",
        driverId: "adb",
      }),
      getCapabilities: async (_id, options) => {
        receivedSignal = options?.signal;
        return new Map([
          [
            "control.press",
            {
              support: "stable",
              readiness: "missing-tool",
              reason: "ADB is missing-tool for 192.168.1.10",
              constraints: { readinessCheck: "live-adb-probe" },
            },
          ],
        ]);
      },
      openDevice: async () => {
        throw new Error("doctor must not open a harness");
      },
    };

    const exit = await runCli(["device", "doctor", "android-lab"], {
      createRuntime: () => runtime,
      stdout: outputs.writeOut,
      stderr: outputs.writeErr,
    });

    expect(exit).toBe(2);
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(outputs.stdout[0]).toContain("control.press\tstable\tmissing-tool");
    expect(outputs.stdout[0]).toContain("Install the required device tool");
  });

  test("reports live Android readiness without opening a harness", async () => {
    const outputs = output();
    let opens = 0;
    const runtime: DeviceRuntime = {
      listDevices: async () => [],
      getDevice: async () => ({
        id: "android-lab",
        name: "Android Lab",
        platform: "android-tv",
        ip: "192.168.1.10",
        driverId: "adb",
      }),
      getCapabilities: async () =>
        new Map([
          [
            "control.press",
            {
              support: "stable",
              readiness: "ready",
              constraints: { readinessCheck: "live-adb-probe" },
            },
          ],
        ]),
      openDevice: async () => {
        opens += 1;
        throw new Error("doctor must not open a harness");
      },
    };

    const exit = await runCli(["device", "doctor", "android-lab", "--json"], {
      createRuntime: () => runtime,
      stdout: outputs.writeOut,
      stderr: outputs.writeErr,
    });

    expect(exit).toBe(0);
    expect(opens).toBe(0);
    expect(JSON.parse(outputs.stdout[0] ?? "")).toMatchObject({
      command: "device.doctor",
      status: "ready",
      exitCode: 0,
      readinessScope: "live",
      capabilities: [{ remediation: "None." }],
    });
  });

  test("prioritizes pairing remediation for misconfigured webOS", async () => {
    const outputs = output();
    const runtime: DeviceRuntime = {
      listDevices: async () => [],
      getDevice: async () => ({
        id: "webos-lab",
        name: "webOS Lab",
        platform: "webos",
        ip: "192.168.1.20",
        driverId: "lg-ssap",
      }),
      getCapabilities: async () =>
        new Map([
          [
            "control.press",
            {
              support: "stable",
              readiness: "misconfigured",
              reason: "LG webOS requires a paired client key",
              constraints: { readinessCheck: "paired-configuration-only" },
            },
          ],
        ]),
      openDevice: async () => {
        throw new Error("doctor must not open a harness");
      },
    };

    const exit = await runCli(["device", "doctor", "webos-lab", "--json"], {
      createRuntime: () => runtime,
      stdout: outputs.writeOut,
      stderr: outputs.writeErr,
    });
    const result = JSON.parse(outputs.stdout[0] ?? "");

    expect(exit).toBe(2);
    expect(result).toMatchObject({
      status: "not-ready",
      readinessScope: "configuration-only",
      capabilities: [
        {
          remediation: "Update the device configuration or pairing credentials, then rerun doctor.",
        },
      ],
    });
    expect(result.capabilities[0].remediation).not.toContain("remote press");
  });

  test("keeps experimental doctor and remote execution eligibility aligned", async () => {
    const doctorOutput = output();
    const pressOutput = output();
    let driverCreations = 0;
    const runtime = createDeviceRuntime({
      inventoryLoader: () => [
        {
          id: "experimental-lab",
          name: "Experimental Lab",
          platform: "android-tv",
          ip: "127.0.0.1",
          driverId: "experimental-driver",
        } satisfies DeviceDescriptor,
      ],
      registry: {
        getRegistration: () => ({
          driverId: "experimental-driver",
          platform: "android-tv",
          getCapabilities: () =>
            new Map([
              [
                "control.press",
                {
                  support: "experimental" as const,
                  readiness: "ready" as const,
                  constraints: { readinessCheck: "live-adb-probe" },
                },
              ],
            ]),
          createDriver: () => {
            driverCreations += 1;
            return {
              adapterId: "experimental-driver",
              open: () => undefined,
              isReady: () => true,
              execute: async () => ({ confirmation: "process-exit" }),
              close: () => undefined,
            };
          },
        }),
      },
    });

    const doctorExit = await runCli(["device", "doctor", "experimental-lab", "--json"], {
      createRuntime: () => runtime,
      stdout: doctorOutput.writeOut,
      stderr: doctorOutput.writeErr,
    });
    const pressExit = await runCli(["remote", "press", "experimental-lab", "LEFT", "--json"], {
      createRuntime: () => runtime,
      stdout: pressOutput.writeOut,
      stderr: pressOutput.writeErr,
    });

    expect(doctorExit).toBe(2);
    expect(JSON.parse(doctorOutput.stdout[0] ?? "")).toMatchObject({
      status: "not-ready",
      exitCode: 2,
      error: { code: "target-not-ready" },
      capabilities: [
        {
          support: "experimental",
          readiness: "ready",
          remediation: "Explicitly allow this experimental operation for the target before use.",
        },
      ],
    });
    expect(pressExit).toBe(2);
    expect(JSON.parse(pressOutput.stdout[0] ?? "")).toMatchObject({
      status: "failed",
      exitCode: 2,
      error: { code: "experimental-operation" },
    });
    expect(driverCreations).toBe(0);
  });

  test("cancels doctor capability inspection without opening a harness", async () => {
    const outputs = output();
    const signals = signalTarget();
    let opens = 0;
    const runtime: DeviceRuntime = {
      listDevices: async () => [],
      getDevice: async () => ({
        id: "lab",
        name: "Lab",
        platform: "android-tv",
        ip: "127.0.0.1",
      }),
      getCapabilities: async (_id, options) => {
        signals.emit("SIGINT");
        expect(options?.signal?.aborted).toBe(true);
        throw options?.signal?.reason;
      },
      openDevice: async () => {
        opens += 1;
        throw new Error("doctor must not open a harness");
      },
    };

    const exit = await runCli(["device", "doctor", "lab", "--json"], {
      createRuntime: () => runtime,
      stdout: outputs.writeOut,
      stderr: outputs.writeErr,
      signalTarget: signals,
    });

    expect(exit).toBe(130);
    expect(opens).toBe(0);
    expect(JSON.parse(outputs.stdout[0] ?? "")).toMatchObject({
      command: "device.doctor",
      status: "cancelled",
      exitCode: 130,
      error: { code: "cancelled" },
    });
  });

  test.each([
    [["device", "list", "--json"], "SIGINT", 130, "device.list"],
    [["device", "list", "--json"], "SIGTERM", 143, "device.list"],
    [["device", "doctor", "lab", "--json"], "SIGINT", 130, "device.doctor"],
    [["device", "doctor", "lab", "--json"], "SIGTERM", 143, "device.doctor"],
  ] as const)("promptly cancels %s with %s when inventory loading never settles", async (args, signal, expectedExit, expectedCommand) => {
    const outputs = output();
    const signals = signalTarget();
    let inventoryStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      inventoryStarted = resolve;
    });
    const runtime = createDeviceRuntime({
      inventoryLoader: () => {
        inventoryStarted();
        return new Promise(() => undefined);
      },
    });

    const command = runCli(args, {
      createRuntime: () => runtime,
      stdout: outputs.writeOut,
      stderr: outputs.writeErr,
      signalTarget: signals,
    });
    await started;
    signals.emit(signal);

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const exit = await Promise.race([
        command,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error(`${expectedCommand} remained hung`)), 500);
        }),
      ]);
      expect(exit).toBe(expectedExit);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    expect(signals.removed).toEqual(["SIGINT", "SIGTERM"]);
    expect(JSON.parse(outputs.stdout[0] ?? "")).toMatchObject({
      command: expectedCommand,
      status: "cancelled",
      exitCode: expectedExit,
    });
  });

  test("uses usage and infrastructure exit codes for list and doctor errors", async () => {
    const invalid = output();
    expect(
      await runCli(["device", "doctor"], {
        stdout: invalid.writeOut,
        stderr: invalid.writeErr,
      }),
    ).toBe(64);
    expect(invalid.stdout).toEqual([]);

    const failed = output();
    const runtime: DeviceRuntime = {
      ...runtimeWithHarness({
        capabilities: new Map(),
        execute: async () => record(1),
        close: async () => undefined,
      }),
      listDevices: async () => {
        throw new Error("inventory unavailable");
      },
    };
    expect(
      await runCli(["device", "list", "--json"], {
        createRuntime: () => runtime,
        stdout: failed.writeOut,
        stderr: failed.writeErr,
      }),
    ).toBe(2);
    expect(JSON.parse(failed.stdout[0] ?? "")).toMatchObject({
      command: "device.list",
      status: "failed",
      exitCode: 2,
      error: { code: "runtime-failed", message: "inventory unavailable" },
    });
  });
});
