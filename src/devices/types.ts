import type { TVDevice, TVPlatform, ConnectionStatus, RemoteKey } from "../types";

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

export interface PairingStep {
  id: string;
  title: string;
  description: string;
  type: "info" | "action" | "input" | "waiting";
  inputType?: "pin" | "text";
}

export interface PairingState {
  currentStep: PairingStep;
  stepIndex: number;
  totalSteps: number;
  inputs: Record<string, string>;
  error?: string;
  isComplete: boolean;
  credentials?: unknown;
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

  startPairing(): Promise<PairingState>;
  submitPairingInput(stepId: string, input: string): Promise<PairingState>;
  cancelPairing(): Promise<void>;

  onStatusChange(callback: (status: ConnectionStatus) => void): () => void;

  dispose(): void;
}

export type CreateDeviceHandler = (device: TVDevice) => DeviceHandler;
