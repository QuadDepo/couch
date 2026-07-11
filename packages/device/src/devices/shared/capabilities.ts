import type { RemoteKey } from "../../types";
import type { DeviceCapabilities, DeviceFeature, TextQuickAction } from "../types";

// Feature set common to every implemented TV platform. Platforms without text
// entry (Philips) drop "text_input"; that is the only feature that varies today.
const TV_FEATURES: DeviceFeature[] = [
  "power",
  "volume",
  "mute",
  "channels",
  "navigation",
  "playback",
  "input_select",
  "text_input",
];

export interface CapabilitiesOptions {
  supportedKeys: Iterable<RemoteKey>;
  /** Whether the platform can send free-form text; also gates the "text_input" feature. */
  textInput: boolean;
  textQuickActions: TextQuickAction[];
  supportsWakeOnLan?: boolean;
}

export function createCapabilities(options: CapabilitiesOptions): DeviceCapabilities {
  const features = options.textInput
    ? TV_FEATURES
    : TV_FEATURES.filter((feature) => feature !== "text_input");

  return {
    supportedFeatures: new Set(features),
    supportedKeys: new Set(options.supportedKeys),
    supportsWakeOnLan: options.supportsWakeOnLan ?? false,
    textInputSupported: options.textInput,
    textQuickActions: options.textQuickActions,
  };
}
