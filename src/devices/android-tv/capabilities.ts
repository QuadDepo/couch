import type { DeviceCapabilities, DeviceFeature, RemoteKey } from "../types";

const supportedFeatures: DeviceFeature[] = [
  "power",
  "volume",
  "mute",
  "channels",
  "navigation",
  "playback",
  "input_select",
  "app_launcher",
  "text_input",
];

const supportedKeys: RemoteKey[] = [
  "UP",
  "DOWN",
  "LEFT",
  "RIGHT",
  "OK",
  "BACK",
  "HOME",
  "MENU",
  "POWER",
  "VOLUME_UP",
  "VOLUME_DOWN",
  "MUTE",
  "CHANNEL_UP",
  "CHANNEL_DOWN",
  "INPUT",
  "PLAY",
  "PAUSE",
  "STOP",
  "REWIND",
  "FAST_FORWARD",
];

export const capabilities: DeviceCapabilities = {
  supportedFeatures: new Set(supportedFeatures),
  supportedKeys: new Set(supportedKeys),
  supportsWakeOnLan: true,
  textInputSupported: true,
};
