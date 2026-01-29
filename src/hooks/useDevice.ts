import { useSelector } from "@xstate/react";
import { useCallback, useMemo } from "react";
import type { DeviceActor } from "../devices/actors";
import { capabilities as androidTVCapabilities } from "../devices/android-tv/capabilities";
import { isPlatformImplemented } from "../devices/factory";
import { capabilities as webosCapabilities } from "../devices/lg-webos/capabilities";
import { capabilities as philipsCapabilities } from "../devices/philips-android-tv/capabilities";
import { capabilities as tizenCapabilities } from "../devices/samsung-tizen/capabilities";
import { selectConnectionStatus } from "../devices/selectors";
import type { CommandResult, DeviceCapabilities } from "../devices/types";
import { useDeviceStore, useSelectedDevice } from "../store/deviceStore";
import type { ConnectionStatus, RemoteKey, TVDevice } from "../types";

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
      case "philips-android-tv":
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
      actor.send({ type: "SEND_KEY", key });
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
      (actor as { send: (event: { type: "SEND_TEXT"; text: string }) => void }).send({
        type: "SEND_TEXT",
        text,
      });
      return { success: true };
    },
    [actor, capabilities],
  );

  const connect = useCallback(() => {
    actor?.send({ type: "CONNECT" });
  }, [actor]);

  const disconnect = useCallback(() => {
    actor?.send({ type: "DISCONNECT" });
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
