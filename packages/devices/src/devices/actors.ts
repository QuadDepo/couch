import type { TVPlatform } from "../types";
import type { AndroidTVDeviceMachineActor } from "./android-tv/machines/device";
import type { AndroidTvRemoteDeviceMachineActor } from "./android-tv-remote/machines/device";
import type { WebOSDeviceMachineActor } from "./lg-webos/machines/device";
import type { PhilipsDeviceMachineActor } from "./philips-android-tv/machines/device";
import type { TizenDeviceMachineActor } from "./samsung-tizen/machines/device";

export type DeviceActor =
  | WebOSDeviceMachineActor
  | AndroidTVDeviceMachineActor
  | AndroidTvRemoteDeviceMachineActor
  | PhilipsDeviceMachineActor
  | TizenDeviceMachineActor;

export interface StoredDeviceActor {
  platform: TVPlatform;
  actor: DeviceActor;
}
