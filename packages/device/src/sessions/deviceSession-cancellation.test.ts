import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeviceDriver } from "../drivers/types";
import { createDeviceInventory } from "../inventory/deviceInventory";
import { openSession, registration, testDevice } from "./testSupport";

const directories: string[] = [];

async function open(driver: DeviceDriver, closeTimeoutMs = 20) {
  const harness = await openSession(driver, closeTimeoutMs);
  directories.push(harness.directory);
  return harness.session;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("DeviceSession cancellation", () => {
  test("turns caller cancellation into a cancelled record", async () => {
    const driver: DeviceDriver = {
      driverId: "test-driver",
      open: () => undefined,
      isReady: () => true,
      execute: (_operation, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(options.signal?.reason));
        }),
      close: () => undefined,
    };
    const session = await open(driver);
    const controller = new AbortController();
    const result = session.execute(
      { kind: "control.press", key: "UP" },
      { signal: controller.signal },
    );

    controller.abort(new Error("caller cancelled"));

    await expect(result).resolves.toMatchObject({
      status: "cancelled",
      error: { code: "cancelled", message: "caller cancelled" },
    });
    await session.close();
  });

  test("reports timeout as infrastructure failure", async () => {
    const driver: DeviceDriver = {
      driverId: "test-driver",
      open: () => undefined,
      isReady: () => true,
      execute: () => new Promise(() => undefined),
      close: () => undefined,
    };
    const session = await open(driver, 5);

    const record = await session.execute({ kind: "control.press", key: "UP" }, { timeoutMs: 1 });

    expect(record).toMatchObject({
      status: "failed",
      error: { code: "operation-timeout", category: "infrastructure" },
    });
    await expect(session.close()).rejects.toMatchObject({ code: "close-timeout" });
  });

  test("retains the lock while a driver is not quiescent", async () => {
    let settle!: () => void;
    const active = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const driver: DeviceDriver = {
      driverId: "test-driver",
      open: () => undefined,
      isReady: () => true,
      execute: () => active.then(() => ({ confirmation: "transport-write" })),
      close: () => undefined,
    };
    const directory = await mkdtemp(join(tmpdir(), "couch-session-lock-"));
    directories.push(directory);
    const options = {
      inventoryLoader: () => [testDevice],
      registry: { getRegistration: () => registration(driver) },
      lockDirectory: directory,
      closeTimeoutMs: 2,
    };
    const first = await createDeviceInventory(options).openSession(testDevice.id, {
      require: ["control.press"],
    });
    const operation = first.execute({ kind: "control.press", key: "UP" }, { timeoutMs: 1 });
    await operation;

    await expect(
      createDeviceInventory(options).openSession(testDevice.id, { require: ["control.press"] }),
    ).rejects.toThrow("already locked");
    settle();
    await first.close();
  });
});
