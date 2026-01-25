import type {
  CommandResult,
  ConnectionStatus,
  DeviceCapabilities,
  KeyMap,
  RemoteKey,
} from "./types";

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
