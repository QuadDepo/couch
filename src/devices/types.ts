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

export type TextQuickAction = "enter" | "space" | "backspace";

export interface DeviceCapabilities {
  supportedFeatures: Set<DeviceFeature>;
  supportedKeys: Set<RemoteKey>;
  supportsWakeOnLan: boolean;
  textInputSupported: boolean;
  textQuickActions: TextQuickAction[];
}

export interface CommandResult {
  success: boolean;
  error?: string;
  latencyMs?: number;
}
