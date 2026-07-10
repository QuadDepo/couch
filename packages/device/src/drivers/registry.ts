import type { AndroidTvDriverDependencies } from "../devices/android-tv/driver";
import type { InventoryTarget } from "../inventory/types";
import { createAndroidRegistration } from "./androidRegistration";
import { deviceLockResourceId } from "./lockResourceId";
import type { DriverRegistration, DriverRegistry } from "./types";
import { createWebosRegistration } from "./webosRegistration";

export interface DriverRegistryOptions {
  registrations?: readonly DriverRegistration[];
  androidTvDependencies?: AndroidTvDriverDependencies;
}

export function createDriverRegistry(options: DriverRegistryOptions = {}): DriverRegistry {
  const registrations = options.registrations ?? [
    createAndroidRegistration(options.androidTvDependencies),
    createWebosRegistration(),
  ];
  const byDriver = new Map(
    registrations.map((registration) => [registration.driverId, registration]),
  );
  return {
    getRegistration(device) {
      if (device.driverId) return byDriver.get(device.driverId);
      const fallback =
        device.platform === "android-tv"
          ? "adb"
          : device.platform === "webos"
            ? "lg-ssap"
            : undefined;
      return fallback ? byDriver.get(fallback) : undefined;
    },
  };
}

export function getLockResourceId(
  device: InventoryTarget,
  registration?: DriverRegistration,
): string {
  if (registration?.lockResourceId) return registration.lockResourceId(device);
  return deviceLockResourceId(device);
}
