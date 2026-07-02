import type { TVDevice, TVPlatform } from "../types";
import { type ImplementedPlatform, platformRegistry } from "./registry";

interface PlatformInfo {
  id: TVPlatform;
  name: string;
  description: string;
}

export const implementedPlatforms: PlatformInfo[] = Object.entries(platformRegistry).map(
  ([id, reg]) => ({
    id: id as ImplementedPlatform,
    name: reg.name,
    description: reg.description,
  }),
);

export function isPlatformImplemented(platform: TVPlatform): boolean {
  return platform in platformRegistry;
}

export function wrapPlatformCredentials(
  platform: TVPlatform,
  credentials: unknown,
): TVDevice["config"] {
  const registration = platformRegistry[platform as ImplementedPlatform];
  if (!registration) return undefined;
  return registration.wrapCredentials(credentials);
}
