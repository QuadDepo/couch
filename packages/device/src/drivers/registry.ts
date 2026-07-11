import type { AndroidTvDriverDependencies } from "../devices/android-tv/driver";
import { createAndroidRegistration } from "./androidRegistration";
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
      return device.driverId ? byDriver.get(device.driverId) : undefined;
    },
  };
}
