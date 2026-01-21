import type { DeviceCapabilities, DeviceFeature } from "../types";
import type { RemoteKey } from "../../types";
import { keymap } from "./keymap";

const supportedFeatures: DeviceFeature[] = [
  "power",
  "volume",
  "mute",
  "channels",
  "navigation",
  "playback",
  "input_select",
  "app_launcher",
];

const supportedKeys = Object.keys(keymap) as RemoteKey[];

export const capabilities: DeviceCapabilities = {
  supportedFeatures: new Set(supportedFeatures),
  supportedKeys: new Set(supportedKeys),
  supportsWakeOnLan: false,
  textInputSupported: false,
};
