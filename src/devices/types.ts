import type { ConnectionStatus, RemoteKey, TVDevice, TVPlatform } from "../types";

export type { TVDevice, TVPlatform, ConnectionStatus, RemoteKey };

export type KeyMap = Partial<Record<RemoteKey, string | number>>;

export type DeviceFeature =
  | "power"
  | "volume"
  | "mute"
  | "channels"
  | "navigation"
  | "playback"
  | "input_select"
  | "app_launcher"
  | "text_input"
  | "wake_on_lan";

export interface DeviceCapabilities {
  supportedFeatures: Set<DeviceFeature>;
  supportedKeys: Set<RemoteKey>;
  supportsWakeOnLan: boolean;
  textInputSupported: boolean;
}

export interface CommandResult {
  success: boolean;
  error?: string;
  latencyMs?: number;
}
