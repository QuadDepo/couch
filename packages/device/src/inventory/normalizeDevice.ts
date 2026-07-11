import type { DriverId, ProductPlatform } from "../operations/types";
import type { DeviceDescriptor, InventoryTarget, PersistedDevice } from "./types";

// Two platform vocabularies meet here. PersistedDevice.platform is the device-facing
// TVPlatform ("lg-webos", "samsung-tizen", "android-tv-remote"); ProductPlatform is the
// coarser product family callers see. driverId is set only for platforms that have a real
// operation driver registered (adb, lg-ssap) — the rest are connection-direct and resolve
// no driver, so leaving it undefined lets the registry raise a specific "no driver" error
// instead of silently borrowing another platform's driver.
function toProductPlatform(platform: PersistedDevice["platform"]): {
  platform: ProductPlatform;
  driverId?: DriverId;
} {
  switch (platform) {
    case "android-tv":
      return { platform: "android-tv", driverId: "adb" };
    case "android-tv-remote":
      return { platform: "android-tv" };
    case "lg-webos":
      return { platform: "webos", driverId: "lg-ssap" };
    case "philips-tv":
      return { platform: "philips-tv" };
    case "samsung-tizen":
      return { platform: "tizen" };
  }
}

export function normalizeDevice(source: PersistedDevice): InventoryTarget {
  const { platform, driverId } = toProductPlatform(source.platform);
  return {
    id: source.id,
    name: source.name,
    platform,
    ip: source.ip,
    ...(source.mac ? { mac: source.mac } : {}),
    ...(driverId ? { driverId } : {}),
    source,
  };
}

export function describeDevice(target: InventoryTarget): DeviceDescriptor {
  return {
    id: target.id,
    name: target.name,
    platform: target.platform,
    ip: target.ip,
    ...(target.mac ? { mac: target.mac } : {}),
    ...(target.driverId ? { driverId: target.driverId } : {}),
  };
}
