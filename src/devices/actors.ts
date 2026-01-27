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
