import { useMemo, useCallback } from "react";
import type { TVDevice, RemoteKey } from "../types";
import type { DeviceCapabilities, CommandResult, PairingState } from "../devices/types";
import { getDeviceHandler, isPlatformImplemented } from "../devices/factory";
import { useDeviceStore } from "../store/deviceStore";

interface UseDeviceHandlerResult {
  status: TVDevice["status"];
  capabilities: DeviceCapabilities | null;
  isImplemented: boolean;

  sendKey: (key: RemoteKey) => Promise<CommandResult>;
  isKeySupported: (key: RemoteKey) => boolean;
  sendText: (text: string) => Promise<CommandResult>;

  connect: () => void;
  disconnect: () => void;

  startPairing: () => Promise<PairingState | null>;
  submitPairingInput: (stepId: string, input: string) => Promise<PairingState | null>;
  cancelPairing: () => Promise<void>;
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
    [handler]
  );

  const isKeySupported = useCallback(
    (key: RemoteKey): boolean => {
      return handler?.isKeySupported(key) ?? false;
    },
    [handler]
  );

  const sendText = useCallback(
    async (text: string): Promise<CommandResult> => {
      if (!handler) {
        return { success: false, error: "No handler available" };
      }
      return handler.sendText(text);
    },
    [handler]
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

  const startPairing = useCallback(async (): Promise<PairingState | null> => {
    return handler?.startPairing() ?? null;
  }, [handler]);

  const submitPairingInput = useCallback(
    async (stepId: string, input: string): Promise<PairingState | null> => {
      return handler?.submitPairingInput(stepId, input) ?? null;
    },
    [handler]
  );

  const cancelPairing = useCallback(async () => {
    await handler?.cancelPairing();
  }, [handler]);

  return {
    status: device?.status ?? "disconnected",
    capabilities: handler?.capabilities ?? null,
    isImplemented,
    sendKey,
    isKeySupported,
    sendText,
    connect,
    disconnect,
    startPairing,
    submitPairingInput,
    cancelPairing,
  };
}
