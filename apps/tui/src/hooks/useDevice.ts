import {
  androidTVCapabilities,
  androidTvRemoteCapabilities,
  type CommandResult,
  type ConnectionStatus,
  type DeviceActor,
  type DeviceCapabilities,
  isPlatformImplemented,
  philipsCapabilities,
  type RemoteKey,
  selectConnectionStatus,
  type TVDevice,
  tizenCapabilities,
  webosCapabilities,
} from "@couch/devices";
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

  const status = useSelector(actor, selectConnectionStatus) ?? "disconnected";

  const isImplemented = device ? isPlatformImplemented(device.platform) : false;

  const capabilities = useMemo(() => {
    switch (device?.platform) {
      case "lg-webos":
        return webosCapabilities;
      case "android-tv":
        return androidTVCapabilities;
      case "android-tv-remote":
        return androidTvRemoteCapabilities;
      case "philips-tv":
        return philipsCapabilities;
      case "samsung-tizen":
        return tizenCapabilities;
      default:
        return null;
    }
  }, [device?.platform]);

  const sendKey = useCallback(
    async (key: RemoteKey): Promise<CommandResult> => {
      if (!actor) {
        return { success: false, error: "No device selected" };
      }
      actor.send({
        type: "SEND_KEY",
        key,
      });
      return { success: true };
    },
    [actor],
  );

  const isKeySupported = useCallback(
    (key: RemoteKey): boolean => {
      return capabilities?.supportedKeys.has(key) ?? false;
    },
    [capabilities],
  );

  const sendText = useCallback(
    async (text: string): Promise<CommandResult> => {
      if (!actor) {
        return { success: false, error: "No device selected" };
      }
      if (!capabilities?.textInputSupported) {
        return { success: false, error: "Text input not supported" };
      }
      actor.send({
        type: "SEND_TEXT",
        text,
      });
      return { success: true };
    },
    [actor, capabilities],
  );

  const connect = useCallback(() => {
    actor?.send({
      type: "CONNECT",
    });
  }, [actor]);

  const disconnect = useCallback(() => {
    actor?.send({
      type: "DISCONNECT",
    });
  }, [actor]);

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
