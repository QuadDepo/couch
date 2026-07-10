import type { DeviceDriver, DriverReceipt, DriverRegistration } from "../drivers/types";
import type { PersistedDevice } from "../inventory/types";
import type { OperationKind } from "../operations/types";

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
    adapterId: "test-driver",
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
    platform: "android-tv",
    createDriver: () => driver,
    getCapabilities: () =>
      new Map(kinds.map((kind) => [kind, { support: "stable", readiness: "ready" }])),
  };
}
