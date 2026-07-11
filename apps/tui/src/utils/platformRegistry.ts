import {
  type ImplementedPlatform,
  type PlatformRegistration,
  platformRegistry,
  type TVPlatform,
} from "@couch/device";

// The registry is keyed by ImplementedPlatform, but a device can carry any
// TVPlatform. Narrow through the cast in exactly one place.
export function lookupPlatformRegistration(platform: TVPlatform): PlatformRegistration | undefined {
  return platformRegistry[platform as ImplementedPlatform];
}
