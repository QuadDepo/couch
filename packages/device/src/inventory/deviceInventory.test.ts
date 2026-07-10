import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeDriver, registration, testDevice } from "../sessions/testSupport";
import { createDeviceInventory } from "./deviceInventory";
import type { PersistedDevice } from "./types";

describe("DeviceInventory", () => {
  test("returns credential-safe descriptors", async () => {
    const devices: PersistedDevice[] = [
      {
        id: "living-room",
        name: "Living Room",
        platform: "lg-webos",
        ip: "192.168.1.50",
        config: { webos: { clientKey: "secret" } },
      },
      testDevice,
    ];
    const inventory = createDeviceInventory({ inventoryLoader: () => devices });

    const descriptors = await inventory.listDevices();

    expect(descriptors).toEqual([
      {
        id: "living-room",
        name: "Living Room",
        platform: "webos",
        ip: "192.168.1.50",
        driverId: "lg-ssap",
      },
      {
        id: "living-room",
        name: "Living Room",
        platform: "android-tv",
        ip: "192.168.1.50",
        driverId: "adb",
      },
    ]);
    expect(JSON.stringify(descriptors)).not.toContain("secret");
  });

  test("cancels a non-settling inventory query", async () => {
    const inventory = createDeviceInventory({
      inventoryLoader: () => new Promise<readonly PersistedDevice[]>(() => undefined),
    });
    const controller = new AbortController();
    const result = inventory.getDevice("living-room", { signal: controller.signal });

    controller.abort(new Error("inventory cancelled"));

    await expect(result).rejects.toThrow("inventory cancelled");
  });

  test("preflights requirements before opening the driver", async () => {
    const driver = fakeDriver();
    const inventory = createDeviceInventory({
      inventoryLoader: () => [testDevice],
      registry: { getRegistration: () => registration(driver, []) },
    });

    await expect(
      inventory.openSession(testDevice.id, { require: ["control.press"] }),
    ).rejects.toMatchObject({ code: "unsupported-operation" });
    expect(driver.calls).toEqual([]);
  });

  test("opens and closes a ready session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "couch-inventory-"));
    const driver = fakeDriver();
    const inventory = createDeviceInventory({
      inventoryLoader: () => [testDevice],
      registry: { getRegistration: () => registration(driver) },
      lockDirectory: directory,
    });
    try {
      const session = await inventory.openSession(testDevice.id, { require: ["control.press"] });
      await session.close();
      expect(driver.calls).toEqual(["open", "close"]);
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});
