import {
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

  sendKey: (key: RemoteKey) => void;
  isKeySupported: (key: RemoteKey) => boolean;
  sendText: (text: string) => void;

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
    (key: RemoteKey): void => {
      send?.({ type: "SEND_KEY", key });
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
    (text: string): void => {
      if (!send || !capabilities?.textInputSupported) return;
      send({ type: "SEND_TEXT", text });
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
