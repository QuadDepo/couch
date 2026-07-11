import {
  type CommonDeviceEvent,
  type ConnectionStatus,
  type DeviceActor,
  type DeviceCapabilities,
  isPlatformImplemented,
  type RemoteKey,
  selectConnectionStatus,
  type TVDevice,
} from "@couch/device";
import { useSelector } from "@xstate/react";
import { useCallback, useMemo } from "react";
import { useDeviceStore, useSelectedDevice } from "../store/deviceStore";
import { lookupPlatformRegistration } from "../utils/platformRegistry.ts";

interface UseDeviceResult {
  device: TVDevice | null;
  status: ConnectionStatus;
  actor: DeviceActor | undefined;
  capabilities: DeviceCapabilities | null;
  isImplemented: boolean;

  sendKey: (key: RemoteKey) => void;
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
    return lookupPlatformRegistration(device.platform)?.capabilities ?? null;
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
    sendText,
    connect,
    disconnect,
  };
}
