import type { DriverId, ProductPlatform } from "../operations/types";
import type { DeviceDescriptor, InventoryTarget, PersistedDevice } from "./types";

function platformDetails(platform: PersistedDevice["platform"]): {
  platform: ProductPlatform;
  driverId: DriverId;
} {
  switch (platform) {
    case "android-tv":
      return { platform, driverId: "adb" };
    case "android-tv-remote":
      return { platform: "android-tv", driverId: "android-remote" };
    case "lg-webos":
      return { platform: "webos", driverId: "lg-ssap" };
    case "philips-tv":
      return { platform, driverId: "philips-jointspace" };
    case "samsung-tizen":
      return { platform: "tizen", driverId: "samsung-remote" };
  }
}

export function normalizeDevice(source: PersistedDevice): InventoryTarget {
  const { platform, driverId } = platformDetails(source.platform);
  return {
    id: source.id,
    name: source.name,
    platform,
    ip: source.ip,
    ...(source.mac ? { mac: source.mac } : {}),
    driverId,
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
