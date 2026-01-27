import type { WebOSCredentials } from "./lg-webos/credentials";
import type { PhilipsCredentials } from "./philips-android-tv/credentials";
import type { TVDevice, TVPlatform } from "./types";

interface PlatformInfo {
  id: TVPlatform;
  name: string;
  description: string;
}

export const implementedPlatforms: PlatformInfo[] = [
  {
    id: "lg-webos",
    name: "LG WebOS TV",
    description: "LG WebOS TVs (via WebSocket)",
  },
  {
    id: "android-tv",
    name: "Android TV (ADB)",
    description: "Android TVs via ADB debugging",
  },
  {
    id: "philips-android-tv",
    name: "Philips Android TV",
    description: "Philips Android TVs (via HTTP)",
  },
];

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
