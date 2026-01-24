import { isValidIp } from "../utils/network.ts";
import type {
  CommandResult,
  ConnectionStatus,
  DeviceCapabilities,
  KeyMap,
  RemoteKey,
} from "./types";

export const WIZARD_TIMEOUTS = {
  CONNECTION: 30000,
  PAIRING: 45000,
} as const;

export function validateDeviceInfo(deviceName: string, deviceIp: string): string | null {
  if (deviceName.trim().length === 0) {
    return "Device name is required";
  }
  if (!isValidIp(deviceIp)) {
    return "Invalid IP address";
  }
  return null;
}

export function createStatusManager() {
  let status: ConnectionStatus = "disconnected";
  const listeners = new Set<(status: ConnectionStatus) => void>();

  return {
    getStatus: () => status,
    setStatus: (newStatus: ConnectionStatus) => {
      status = newStatus;
      for (const cb of listeners) {
        cb(status);
      }
    },
    onStatusChange: (cb: (status: ConnectionStatus) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    clearListeners: () => listeners.clear(),
  };
}

export function createKeySender(
  keyMap: KeyMap,
  capabilities: DeviceCapabilities,
  sendPlatformKey: (code: string | number) => Promise<CommandResult>,
) {
  return async (key: RemoteKey): Promise<CommandResult> => {
    if (!capabilities.supportedKeys.has(key)) {
      return { success: false, error: `Key ${key} not supported` };
    }
    const platformKey = keyMap[key];
    if (!platformKey) {
      return { success: false, error: `No mapping for ${key}` };
    }
    return sendPlatformKey(platformKey);
  };
}
