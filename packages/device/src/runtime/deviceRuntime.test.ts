import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TVDevice } from "../types";
import { createDeviceLock } from "./deviceLock";
import { createDeviceRuntime } from "./deviceRuntime";
import { createTargetRegistry } from "./targetRegistry";
import type {
  DeviceDescriptor,
  DeviceDriver,
  DriverReceipt,
  DriverRegistration,
  OperationKind,
} from "./types";

const device: DeviceDescriptor = {
  id: "living-room",
  name: "Living Room",
  platform: "android-tv",
  ip: "192.168.1.50",
};

function registration(
  driver: DeviceDriver,
  capabilities: OperationKind[] = ["control.press"],
): DriverRegistration {
  return {
    driverId: "test-driver",
    platform: "android-tv",
    createDriver: () => driver,
    getCapabilities: () =>
      new Map(capabilities.map((kind) => [kind, { support: "stable", readiness: "ready" }])),
  };
}

function fakeDriver(
  receipts: DriverReceipt[] = [{ confirmation: "process-exit" }],
): DeviceDriver & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    adapterId: "test-driver",
    open: () => calls.push("open"),
    isReady: () => true,
    execute: async (operation) => {
      calls.push(operation.kind);
      return receipts.shift() ?? { confirmation: "transport-write" };
    },
    close: () => calls.push("close"),
  };
}

describe("DeviceRuntime", () => {
  test("separates product identity from driver identity without exposing credentials", async () => {
    const inventoryDevice: TVDevice<"lg-webos"> = {
      id: "living-room",
      name: "Living Room",
      platform: "lg-webos",
      ip: "192.168.1.50",
      config: {
        webos: {
          clientKey: "secret-client-key",
          mac: "",
          useSsl: false,
          lastUpdated: "2026-07-10T00:00:00.000Z",
        },
      },
    };
    const runtime = createDeviceRuntime({ inventoryLoader: () => [inventoryDevice] });

    const descriptor = await runtime.getDevice("living-room");

    expect(descriptor).toMatchObject({ platform: "webos", driverId: "lg-ssap" });
    expect(descriptor).not.toHaveProperty("config");
    expect(JSON.stringify(descriptor)).not.toContain("secret-client-key");
  });

  test("fails capability preflight when webOS credentials are missing", async () => {
    const inventoryDevice: TVDevice<"lg-webos"> = {
      id: "living-room",
      name: "Living Room",
      platform: "lg-webos",
      ip: "192.168.1.50",
    };
    const runtime = createDeviceRuntime({ inventoryLoader: () => [inventoryDevice] });

    await expect(
      runtime.openDevice("living-room", { require: ["control.press"] }),
    ).rejects.toMatchObject({ code: "unsupported-operation" });
  });

  test("exposes asynchronously probed capabilities without opening the device", async () => {
    const driver = fakeDriver();
    let probes = 0;
    const runtime = createDeviceRuntime({
      inventoryLoader: () => [device],
      registry: {
        getRegistration: () => ({
          ...registration(driver),
          getCapabilities: async (_target, options) => {
            expect(options?.signal).toBeUndefined();
            probes += 1;
            return new Map([["control.press", { support: "stable", readiness: "ready" } as const]]);
          },
        }),
      },
    });

    const capabilities = await runtime.getCapabilities("living-room");

    expect(capabilities.get("control.press")).toMatchObject({
      support: "stable",
      readiness: "ready",
    });
    expect(probes).toBe(1);
    expect(driver.calls).toEqual([]);
  });

  test.each([
    ["missing-tool", [Object.assign(new Error("adb not found"), { code: "ENOENT" })]],
    ["unauthorized", ["connected", "error: device unauthorized"]],
    ["offline", ["failed to connect: Connection refused"]],
  ] as const)("reports Android %s readiness before opening a harness", async (expected, outputs) => {
    let index = 0;
    const runtime = createDeviceRuntime({
      inventoryLoader: () => [device],
      registry: createTargetRegistry({
        androidTvDependencies: {
          runCommand: async () => {
            const output = outputs[index++];
            if (output instanceof Error) throw output;
            return output ?? "";
          },
        },
      }),
    });

    const capabilities = await runtime.getCapabilities("living-room");

    expect(capabilities.get("control.press")?.readiness).toBe(expected);
    index = 0;
    await expect(
      runtime.openDevice("living-room", { require: ["control.press"] }),
    ).rejects.toMatchObject({ code: "unsupported-operation" });
  });

  test("preflights required operations and records awaited driver receipts in FIFO order", async () => {
    const lockDirectory = await mkdtemp(join(tmpdir(), "couch-runtime-"));
    const driver = fakeDriver([
      { confirmation: "process-exit", metadata: { command: "input" } },
      { confirmation: "protocol-response" },
    ]);
    const runtime = createDeviceRuntime({
      inventoryLoader: () => [device],
      registry: { getRegistration: () => registration(driver, ["control.press", "control.text"]) },
      lockDirectory,
      runId: "test-run",
    });

    const harness = await runtime.openDevice("living-room", {
      require: ["control.press", "control.text"],
    });
    const [first, second] = await Promise.all([
      harness.execute({ kind: "control.press", key: "LEFT" }),
      harness.execute({ kind: "control.text", text: "hi" }),
    ]);

    expect(first.status).toBe("succeeded");
    expect(first.confirmation).toBe("process-exit");
    expect(first.input).toEqual({ key: "LEFT" });
    expect(second.ordinal).toBe(first.ordinal + 1);
    expect(driver.calls).toEqual(["open", "control.press", "control.text"]);
    await harness.close();
    await rm(lockDirectory, { recursive: true, force: true });
  });

  test("fails preflight before opening the driver when an operation is not ready", async () => {
    const lockDirectory = await mkdtemp(join(tmpdir(), "couch-runtime-"));
    const driver = fakeDriver();
    const runtime = createDeviceRuntime({
      inventoryLoader: () => [device],
      registry: { getRegistration: () => registration(driver) },
      lockDirectory,
    });

    await expect(
      runtime.openDevice("living-room", { require: ["screen.capture"] }),
    ).rejects.toMatchObject({ code: "unsupported-operation" });
    expect(driver.calls).toEqual([]);
    await rm(lockDirectory, { recursive: true, force: true });
  });

  test("turns caller cancellation into a cancelled operation and closes cleanly", async () => {
    const lockDirectory = await mkdtemp(join(tmpdir(), "couch-runtime-"));
    let release!: () => void;
    const driver = fakeDriver();
    driver.execute = async (_operation, { signal }) =>
      await new Promise<DriverReceipt>((resolve, reject) => {
        release = () => resolve({ confirmation: "transport-write" });
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    const runtime = createDeviceRuntime({
      inventoryLoader: () => [device],
      registry: { getRegistration: () => registration(driver) },
      lockDirectory,
    });
    const harness = await runtime.openDevice("living-room", { require: ["control.press"] });
    const controller = new AbortController();
    const result = harness.execute(
      { kind: "control.press", key: "LEFT" },
      { signal: controller.signal },
    );
    controller.abort();
    await expect(result).resolves.toMatchObject({ status: "cancelled" });
    release?.();
    await harness.close();
    expect(driver.calls.at(-1)).toBe("close");
    await rm(lockDirectory, { recursive: true, force: true });
  });

  test("cancels queued work without aborting the active operation", async () => {
    const lockDirectory = await mkdtemp(join(tmpdir(), "couch-runtime-"));
    let finishActive!: () => void;
    let activeAborted = false;
    const driver = fakeDriver();
    driver.execute = async (_operation, { signal }) =>
      await new Promise<DriverReceipt>((resolve, reject) => {
        finishActive = () => resolve({ confirmation: "process-exit" });
        signal?.addEventListener(
          "abort",
          () => {
            activeAborted = true;
            reject(signal.reason);
          },
          { once: true },
        );
      });
    const runtime = createDeviceRuntime({
      inventoryLoader: () => [device],
      registry: { getRegistration: () => registration(driver) },
      lockDirectory,
    });
    const harness = await runtime.openDevice("living-room", { require: ["control.press"] });
    const active = harness.execute({ kind: "control.press", key: "LEFT" });
    const controller = new AbortController();
    const queued = harness.execute(
      { kind: "control.press", key: "RIGHT" },
      { signal: controller.signal },
    );

    controller.abort();

    await expect(queued).resolves.toMatchObject({ status: "cancelled" });
    expect(activeAborted).toBe(false);
    finishActive();
    await expect(active).resolves.toMatchObject({ status: "succeeded" });
    await harness.close();
    await rm(lockDirectory, { recursive: true, force: true });
  });

  test("quarantines a non-cooperative active operation until it quiesces", async () => {
    const lockDirectory = await mkdtemp(join(tmpdir(), "couch-runtime-"));
    const driver = fakeDriver();
    let finish!: () => void;
    driver.execute = async () =>
      await new Promise<DriverReceipt>((resolve) => {
        finish = () => resolve({ confirmation: "process-exit" });
      });
    const runtime = createDeviceRuntime({
      inventoryLoader: () => [device],
      registry: { getRegistration: () => registration(driver) },
      lockDirectory,
      closeTimeoutMs: 1,
    });
    const harness = await runtime.openDevice("living-room", { require: ["control.press"] });
    const active = harness.execute({ kind: "control.press", key: "LEFT" });
    const queued = harness.execute({ kind: "control.press", key: "RIGHT" });

    await expect(harness.close()).rejects.toMatchObject({ code: "close-timeout" });

    await expect(active).resolves.toMatchObject({ status: "cancelled" });
    await expect(queued).resolves.toMatchObject({ status: "cancelled" });
    await expect(
      createDeviceLock(lockDirectory).acquire(`adb:${device.ip}:5555`, {
        isProcessAlive: () => true,
      }),
    ).rejects.toThrow(/already locked/);

    finish();
    await harness.close();
    const reacquired = await createDeviceLock(lockDirectory).acquire(`adb:${device.ip}:5555`);
    await reacquired.release();
    await rm(lockDirectory, { recursive: true, force: true });
  });

  test("retains the lock when driver close times out, then releases after quiescence", async () => {
    const lockDirectory = await mkdtemp(join(tmpdir(), "couch-runtime-"));
    const driver = fakeDriver();
    let finishClose!: () => void;
    driver.close = async () =>
      await new Promise<void>((resolve) => {
        finishClose = resolve;
      });
    const runtime = createDeviceRuntime({
      inventoryLoader: () => [device],
      registry: { getRegistration: () => registration(driver) },
      lockDirectory,
      closeTimeoutMs: 1,
    });
    const harness = await runtime.openDevice("living-room", { require: ["control.press"] });

    await expect(harness.close()).rejects.toMatchObject({ code: "close-timeout" });
    await expect(
      createDeviceLock(lockDirectory).acquire(`adb:${device.ip}:5555`, {
        isProcessAlive: () => true,
      }),
    ).rejects.toThrow(/already locked/);

    finishClose();
    await harness.close();
    const reacquired = await createDeviceLock(lockDirectory).acquire(`adb:${device.ip}:5555`);
    await reacquired.release();
    await rm(lockDirectory, { recursive: true, force: true });
  });

  test("lets driver close terminate an active operation before releasing the lock", async () => {
    const lockDirectory = await mkdtemp(join(tmpdir(), "couch-runtime-"));
    const driver = fakeDriver();
    let finish!: () => void;
    driver.execute = async () =>
      await new Promise<DriverReceipt>((resolve) => {
        finish = () => resolve({ confirmation: "process-exit" });
      });
    driver.close = () => finish();
    const runtime = createDeviceRuntime({
      inventoryLoader: () => [device],
      registry: { getRegistration: () => registration(driver) },
      lockDirectory,
      closeTimeoutMs: 10,
    });
    const harness = await runtime.openDevice("living-room", { require: ["control.press"] });
    const active = harness.execute({ kind: "control.press", key: "LEFT" });

    await harness.close();
    await expect(active).resolves.toMatchObject({ status: "cancelled" });
    const reacquired = await createDeviceLock(lockDirectory).acquire(`adb:${device.ip}:5555`);
    await reacquired.release();
    await rm(lockDirectory, { recursive: true, force: true });
  });

  test("records an unsupported execute without invoking the driver", async () => {
    const lockDirectory = await mkdtemp(join(tmpdir(), "couch-runtime-"));
    const driver = fakeDriver();
    const runtime = createDeviceRuntime({
      inventoryLoader: () => [device],
      registry: { getRegistration: () => registration(driver) },
      lockDirectory,
    });
    const harness = await runtime.openDevice("living-room", { require: [] });
    const record = await harness.execute({ kind: "screen.capture" });
    expect(record).toMatchObject({ status: "failed", error: { code: "unsupported-operation" } });
    expect(driver.calls).toEqual(["open"]);
    await harness.close();
    await rm(lockDirectory, { recursive: true, force: true });
  });

  test("reports timeout as infrastructure failure rather than caller cancellation", async () => {
    const lockDirectory = await mkdtemp(join(tmpdir(), "couch-runtime-"));
    const driver = fakeDriver();
    driver.execute = async (_operation, { signal }) =>
      await new Promise<DriverReceipt>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    const runtime = createDeviceRuntime({
      inventoryLoader: () => [device],
      registry: { getRegistration: () => registration(driver) },
      lockDirectory,
    });
    const harness = await runtime.openDevice("living-room", { require: ["control.press"] });
    const record = await harness.execute({ kind: "control.press", key: "LEFT" }, { timeoutMs: 1 });
    expect(record).toMatchObject({
      status: "failed",
      error: { code: "operation-timeout", category: "infrastructure" },
    });
    const reacquired = await createDeviceLock(lockDirectory).acquire(`adb:${device.ip}:5555`, {
      isProcessAlive: () => false,
    });
    await reacquired.release();
    await harness.close();
    await rm(lockDirectory, { recursive: true, force: true });
  });
});
