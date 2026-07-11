import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeviceDriver, DriverReceipt, DriverRegistration } from "../drivers/types";
import { createDeviceInventory } from "../inventory/deviceInventory";
import type { PersistedDevice } from "../inventory/types";
import type { OperationKind } from "../operations/types";
import type { DeviceSession } from "./deviceSession";

export const testDevice: PersistedDevice = {
  id: "living-room",
  name: "Living Room",
  platform: "android-tv",
  ip: "192.168.1.50",
};

export function fakeDriver(
  receipts: DriverReceipt[] = [{ confirmation: "process-exit" }],
): DeviceDriver & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    driverId: "test-driver",
    open: () => {
      calls.push("open");
    },
    isReady: () => true,
    execute: async (operation) => {
      calls.push(operation.kind);
      return receipts.shift() ?? { confirmation: "transport-write" };
    },
    close: () => {
      calls.push("close");
    },
  };
}

export function registration(
  driver: DeviceDriver,
  kinds: OperationKind[] = ["control.press"],
): DriverRegistration {
  return {
    driverId: "test-driver",
    createDriver: () => driver,
    getCapabilities: () =>
      new Map(kinds.map((kind) => [kind, { support: "stable", readiness: "ready" }])),
  };
}

export interface SessionHarness<D extends DeviceDriver> {
  driver: D;
  directory: string;
  session: DeviceSession;
}

export async function openSession<D extends DeviceDriver>(
  driver: D,
  closeTimeoutMs?: number,
): Promise<SessionHarness<D>> {
  const directory = await mkdtemp(join(tmpdir(), "couch-session-"));
  const inventory = createDeviceInventory({
    inventoryLoader: () => [testDevice],
    registry: { getRegistration: () => registration(driver) },
    lockDirectory: directory,
    ...(closeTimeoutMs !== undefined ? { closeTimeoutMs } : {}),
  });
  const session = await inventory.openSession(testDevice.id, { require: ["control.press"] });
  return { driver, directory, session };
}
