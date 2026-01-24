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

export interface DeviceHandler {
  platform: TVPlatform;
  device: TVDevice;
  capabilities: DeviceCapabilities;

  getStatus(): ConnectionStatus;
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  sendKey(key: RemoteKey): Promise<CommandResult>;
  isKeySupported(key: RemoteKey): boolean;
  sendText(text: string): Promise<CommandResult>;

  onStatusChange(callback: (status: ConnectionStatus) => void): () => void;

  dispose(): void;
}

export type CreateDeviceHandler = (device: TVDevice) => DeviceHandler;

export interface BaseWizardContext {
  deviceName: string;
  deviceIp: string;
  activeField: "name" | "ip";
  error: string | null;
}

export interface BaseWizardInput {
  deviceName?: string;
  deviceIp?: string;
}

export interface BaseWizardOutput {
  deviceName: string;
  deviceIp: string;
  platform: TVPlatform;
  credentials: unknown;
}

export type BaseWizardEvent =
  | { type: "CHAR_INPUT"; char: string }
  | { type: "BACKSPACE" }
  | { type: "TAB" }
  | { type: "SUBMIT" }
  | { type: "CANCEL" }
  | { type: "RETRY" }
  | { type: "BACK" };

export interface PairingUIState {
  title: string;
  description: string;
  variant: "info" | "action" | "input" | "loading" | "error";
  input?: {
    type: "pin" | "text" | "code";
    value: string;
    maxLength?: number;
  };
  canRetry?: boolean;
}
