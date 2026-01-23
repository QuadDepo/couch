import { createAndroidTVHandler } from "./android-tv/handler";
import type { WebOSCredentials } from "./lg-webos/credentials";
import { createWebOSHandler } from "./lg-webos/handler";
import type { PhilipsCredentials } from "./philips-android-tv/credentials";
import { createPhilipsAndroidTVHandler } from "./philips-android-tv/handler";
import type { CreateDeviceHandler, DeviceHandler, TVDevice, TVPlatform } from "./types";

interface PlatformInfo {
  id: TVPlatform;
  name: string;
  description: string;
}

export const implementedPlatforms: PlatformInfo[] = [
  {
    id: "android-tv",
    name: "Android TV",
    description: "Google, Sony, TCL, Hisense (via ADB)",
  },
  {
    id: "philips-android-tv",
    name: "Philips Android TV",
    description: "Philips TVs (via JointSpace API)",
  },
  {
    id: "lg-webos",
    name: "LG WebOS TV",
    description: "LG WebOS TVs (via WebSocket)",
  },
];

function notImplemented(platform: TVPlatform): CreateDeviceHandler {
  return () => {
    throw new Error(`Platform ${platform} is not yet implemented`);
  };
}

const platformFactories: Record<TVPlatform, CreateDeviceHandler> = {
  "android-tv": createAndroidTVHandler,
  "philips-android-tv": createPhilipsAndroidTVHandler,
  "lg-webos": createWebOSHandler,
  "apple-tv": notImplemented("apple-tv"),
  "samsung-tizen": notImplemented("samsung-tizen"),
  "titan-os": notImplemented("titan-os"),
};

const handlers = new Map<string, DeviceHandler>();

export function getDeviceHandler(device: TVDevice): DeviceHandler {
  const cached = handlers.get(device.id);
  if (cached && cached.platform === device.platform) {
    return cached;
  }

  const factory = platformFactories[device.platform];
  const handler = factory(device);
  handlers.set(device.id, handler);
  return handler;
}

export function disposeHandler(deviceId: string): void {
  const handler = handlers.get(deviceId);
  if (handler) {
    handler.dispose();
    handlers.delete(deviceId);
  }
}
export function isPlatformImplemented(platform: TVPlatform): boolean {
  return implementedPlatforms.some((p) => p.id === platform);
}

export function wrapPlatformCredentials(
  platform: TVPlatform,
  credentials: unknown,
): TVDevice["config"] {
  if (platform === "lg-webos") {
    return { webos: credentials as WebOSCredentials };
  }
  if (platform === "philips-android-tv") {
    return { philips: credentials as PhilipsCredentials };
  }
  return undefined;
}
