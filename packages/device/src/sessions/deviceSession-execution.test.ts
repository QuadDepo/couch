import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DriverReceipt } from "../drivers/types";
import { createDeviceInventory } from "../inventory/deviceInventory";
import { fakeDriver, registration, testDevice } from "./testSupport";

const directories: string[] = [];

async function open(driver = fakeDriver()) {
  const directory = await mkdtemp(join(tmpdir(), "couch-session-"));
  directories.push(directory);
  const inventory = createDeviceInventory({
    inventoryLoader: () => [testDevice],
    registry: { getRegistration: () => registration(driver) },
    lockDirectory: directory,
  });
  return {
    driver,
    session: await inventory.openSession(testDevice.id, { require: ["control.press"] }),
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("DeviceSession execution", () => {
  test("executes operations in FIFO order with awaited receipts", async () => {
    const { driver, session } = await open(
      fakeDriver([{ confirmation: "process-exit" }, { confirmation: "transport-write" }]),
    );

    const [first, second] = await Promise.all([
      session.execute({ kind: "control.press", key: "UP" }),
      session.execute({ kind: "control.press", key: "DOWN" }),
    ]);

    expect([first.ordinal, second.ordinal]).toEqual([1, 2]);
    expect([first.confirmation, second.confirmation]).toEqual(["process-exit", "transport-write"]);
    expect(driver.calls).toEqual(["open", "control.press", "control.press"]);
    await session.close();
  });

  test("records unsupported execution without invoking the driver", async () => {
    const { driver, session } = await open();

    const record = await session.execute({ kind: "control.text", text: "hello" });

    expect(record).toMatchObject({ status: "failed", error: { code: "unsupported-operation" } });
    expect(driver.calls).toEqual(["open"]);
    await session.close();
  });

  test("cancels queued work without aborting the active operation", async () => {
    let finishActive!: () => void;
    let activeAborted = false;
    const driver = fakeDriver();
    driver.execute = (_operation, options) =>
      new Promise<DriverReceipt>((resolve, reject) => {
        finishActive = () => resolve({ confirmation: "process-exit" });
        options?.signal?.addEventListener("abort", () => {
          activeAborted = true;
          reject(options.signal?.reason);
        });
      });
    const { session } = await open(driver);
    const active = session.execute({ kind: "control.press", key: "LEFT" });
    const controller = new AbortController();
    const queued = session.execute(
      { kind: "control.press", key: "RIGHT" },
      { signal: controller.signal },
    );

    controller.abort();

    await expect(queued).resolves.toMatchObject({ status: "cancelled" });
    expect(activeAborted).toBe(false);
    finishActive();
    await expect(active).resolves.toMatchObject({ status: "succeeded" });
    await session.close();
  });
});
