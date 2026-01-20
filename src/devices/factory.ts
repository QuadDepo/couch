import type { TVDevice, TVPlatform, DeviceHandler, CreateDeviceHandler } from "./types";
import { createAndroidTVHandler } from "./android-tv/handler";

function notImplemented(platform: TVPlatform): CreateDeviceHandler {
  return () => {
    throw new Error(`Platform ${platform} is not yet implemented`);
  };
}

const platformFactories: Record<TVPlatform, CreateDeviceHandler> = {
  "android-tv": createAndroidTVHandler,
  "apple-tv": notImplemented("apple-tv"),
  "lg-webos": notImplemented("lg-webos"),
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
  return platform === "android-tv";
}
