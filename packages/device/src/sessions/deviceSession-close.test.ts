import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeviceDriver, DriverReceipt } from "../drivers/types";
import { createDeviceInventory } from "../inventory/deviceInventory";
import { createDeviceLock } from "../locks/deviceLock";
import { fakeDriver, registration, testDevice } from "./testSupport";

const directories: string[] = [];

async function setup(driver: DeviceDriver, closeTimeoutMs: number) {
  const directory = await mkdtemp(join(tmpdir(), "couch-session-close-"));
  directories.push(directory);
  const inventory = createDeviceInventory({
    inventoryLoader: () => [testDevice],
    registry: { getRegistration: () => registration(driver) },
    lockDirectory: directory,
    closeTimeoutMs,
  });
  return {
    directory,
    session: await inventory.openSession(testDevice.id, { require: ["control.press"] }),
  };
}

async function expectLocked(directory: string) {
  await expect(createDeviceLock(directory).acquire(`adb:${testDevice.ip}:5555`)).rejects.toThrow(
    "already locked",
  );
}

async function expectReleased(directory: string) {
  const lock = await createDeviceLock(directory).acquire(`adb:${testDevice.ip}:5555`);
  await lock.release();
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("DeviceSession close", () => {
  test("retains the lock after driver-close timeout and releases it after quiescence", async () => {
    let finishClose!: () => void;
    const driver = fakeDriver();
    driver.close = () =>
      new Promise<void>((resolve) => {
        finishClose = resolve;
      });
    const { directory, session } = await setup(driver, 1);

    await expect(session.close()).rejects.toMatchObject({ code: "close-timeout" });
    await expectLocked(directory);
    finishClose();
    await session.close();
    await expectReleased(directory);
  });

  test("lets driver close terminate active work before releasing the lock", async () => {
    let finish!: () => void;
    const driver = fakeDriver();
    driver.execute = () =>
      new Promise<DriverReceipt>((resolve) => {
        finish = () => resolve({ confirmation: "process-exit" });
      });
    driver.close = () => finish();
    const { directory, session } = await setup(driver, 20);
    const active = session.execute({ kind: "control.press", key: "LEFT" });

    await session.close();

    await expect(active).resolves.toMatchObject({ status: "cancelled" });
    await expectReleased(directory);
  });
});
