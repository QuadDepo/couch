import type { TVPlatform } from "../types";
import type { AndroidTVDeviceMachineActor } from "./android-tv/machines/device";
import type { WebOSDeviceMachineActor } from "./lg-webos/machines/device";
import type { PhilipsDeviceMachineActor } from "./philips-android-tv/machines/device";

export type DeviceActor =
  | WebOSDeviceMachineActor
  | AndroidTVDeviceMachineActor
  | PhilipsDeviceMachineActor;

export interface StoredDeviceActor {
  platform: TVPlatform;
  actor: DeviceActor;
}

function isWebOSStoredActor(
  stored: StoredDeviceActor,
): stored is { platform: "lg-webos"; actor: WebOSDeviceMachineActor } {
  return stored.platform === "lg-webos";
}

function isAndroidTVStoredActor(
  stored: StoredDeviceActor,
): stored is { platform: "android-tv"; actor: AndroidTVDeviceMachineActor } {
  return stored.platform === "android-tv";
}

function isPhilipsStoredActor(
  stored: StoredDeviceActor,
): stored is { platform: "philips-android-tv"; actor: PhilipsDeviceMachineActor } {
  return stored.platform === "philips-android-tv";
}

function withTypedActor<T>(
  stored: StoredDeviceActor,
  operations: {
    webos?: (actor: WebOSDeviceMachineActor) => T;
    androidTV?: (actor: AndroidTVDeviceMachineActor) => T;
    philips?: (actor: PhilipsDeviceMachineActor) => T;
  },
): T | undefined {
  if (isWebOSStoredActor(stored) && operations.webos) {
    return operations.webos(stored.actor);
  }
  if (isAndroidTVStoredActor(stored) && operations.androidTV) {
    return operations.androidTV(stored.actor);
  }
  if (isPhilipsStoredActor(stored) && operations.philips) {
    return operations.philips(stored.actor);
  }
  return undefined;
}
