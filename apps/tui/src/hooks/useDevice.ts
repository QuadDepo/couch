import {
  type CommandResult,
  type CommonDeviceEvent,
  type ConnectionStatus,
  type DeviceActor,
  type DeviceCapabilities,
  type ImplementedPlatform,
  isPlatformImplemented,
  platformRegistry,
  type RemoteKey,
  selectConnectionStatus,
  type TVDevice,
} from "@couch/device";
import { useSelector } from "@xstate/react";
import { useCallback, useMemo } from "react";
import { useDeviceStore, useSelectedDevice } from "../store/deviceStore";

interface UseDeviceResult {
  device: TVDevice | null;
  status: ConnectionStatus;
  actor: DeviceActor | undefined;
  capabilities: DeviceCapabilities | null;
  isImplemented: boolean;

  sendKey: (key: RemoteKey) => Promise<CommandResult>;
  isKeySupported: (key: RemoteKey) => boolean;
  sendText: (text: string) => Promise<CommandResult>;

  connect: () => void;
  disconnect: () => void;
}

export function useDevice(deviceOverride?: TVDevice | null): UseDeviceResult {
  const selectedDevice = useSelectedDevice();
  // undefined = use selected device, explicit null/device = use what was passed
  const device = deviceOverride === undefined ? selectedDevice : deviceOverride;

  const actor = useDeviceStore((s) => (device ? s.deviceActors.get(device.id)?.actor : undefined));

  const status: ConnectionStatus = useSelector(actor, selectConnectionStatus) ?? "disconnected";

  const isImplemented = device ? isPlatformImplemented(device.platform) : false;

  const capabilities = useMemo((): DeviceCapabilities | null => {
    if (!device?.platform) return null;
    return platformRegistry[device.platform as ImplementedPlatform]?.capabilities ?? null;
  }, [device?.platform]);

  // Stable identity: recreating send per render caused a re-render regression
  const send = useMemo(
    () => (actor ? (event: CommonDeviceEvent) => actor.send(event) : undefined),
    [actor],
  );

  const sendKey = useCallback(
    async (key: RemoteKey): Promise<CommandResult> => {
      if (!send) {
        return { success: false, error: "No device selected" };
      }
      send({ type: "SEND_KEY", key });
      return { success: true };
    },
    [send],
  );

  const isKeySupported = useCallback(
    (key: RemoteKey): boolean => {
      return capabilities?.supportedKeys.has(key) ?? false;
    },
    [capabilities],
  );

  const sendText = useCallback(
    async (text: string): Promise<CommandResult> => {
      if (!send) {
        return { success: false, error: "No device selected" };
      }
      if (!capabilities?.textInputSupported) {
        return { success: false, error: "Text input not supported" };
      }
      send({ type: "SEND_TEXT", text });
      return { success: true };
    },
    [send, capabilities],
  );

  const connect = useCallback(() => {
    send?.({ type: "CONNECT" });
  }, [send]);

  const disconnect = useCallback(() => {
    send?.({ type: "DISCONNECT" });
  }, [send]);

  return {
    device,
    status,
    actor,
    capabilities,
    isImplemented,
    sendKey,
    isKeySupported,
    sendText,
    connect,
    disconnect,
  };
}
