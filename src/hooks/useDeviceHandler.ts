import { useCallback, useMemo } from "react";
import { getDeviceHandler, isPlatformImplemented } from "../devices/factory";
import type { CommandResult, DeviceCapabilities } from "../devices/types";
import { useDeviceStore } from "../store/deviceStore";
import type { RemoteKey, TVDevice } from "../types";

interface UseDeviceHandlerResult {
  status: TVDevice["status"];
  capabilities: DeviceCapabilities | null;
  isImplemented: boolean;

  sendKey: (key: RemoteKey) => Promise<CommandResult>;
  isKeySupported: (key: RemoteKey) => boolean;
  sendText: (text: string) => Promise<CommandResult>;

  connect: () => void;
  disconnect: () => void;
}

export function useDeviceHandler(device: TVDevice | null): UseDeviceHandlerResult {
  const connectDevice = useDeviceStore((s) => s.connectDevice);
  const disconnectDevice = useDeviceStore((s) => s.disconnectDevice);

  const handler = useMemo(() => {
    if (!device || !isPlatformImplemented(device.platform)) return null;
    return getDeviceHandler(device);
  }, [device?.id, device?.platform]);

  const isImplemented = device ? isPlatformImplemented(device.platform) : false;

  const sendKey = useCallback(
    async (key: RemoteKey): Promise<CommandResult> => {
      if (!handler) {
        return { success: false, error: "No handler available" };
      }
      return handler.sendKey(key);
    },
    [handler],
  );

  const isKeySupported = useCallback(
    (key: RemoteKey): boolean => {
      return handler?.isKeySupported(key) ?? false;
    },
    [handler],
  );

  const sendText = useCallback(
    async (text: string): Promise<CommandResult> => {
      if (!handler) {
        return { success: false, error: "No handler available" };
      }
      return handler.sendText(text);
    },
    [handler],
  );

  const connect = useCallback(() => {
    if (device) {
      connectDevice(device.id);
    }
  }, [device?.id, connectDevice]);

  const disconnect = useCallback(() => {
    if (device) {
      disconnectDevice(device.id);
    }
  }, [device?.id, disconnectDevice]);

  return {
    status: device?.status ?? "disconnected",
    capabilities: handler?.capabilities ?? null,
    isImplemented,
    sendKey,
    isKeySupported,
    sendText,
    connect,
    disconnect,
  };
}
