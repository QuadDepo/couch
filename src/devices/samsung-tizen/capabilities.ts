import type { RemoteKey } from "../../types";
import type { DeviceCapabilities, DeviceFeature } from "../types";
import { keymap } from "./keymap";

const supportedFeatures: DeviceFeature[] = [
  "power",
  "volume",
  "mute",
  "channels",
  "navigation",
  "playback",
  "input_select",
  "text_input",
  "wake_on_lan",
];

const supportedKeys = Object.keys(keymap) as RemoteKey[];

export const capabilities: DeviceCapabilities = {
  supportedFeatures: new Set(supportedFeatures),
  supportedKeys: new Set(supportedKeys),
  supportsWakeOnLan: true,
  textInputSupported: true,
  textQuickActions: ["enter"],
};
