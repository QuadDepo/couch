import type { ConnectionStatus } from "../types";
import type { AndroidTVDeviceMachineSnapshot } from "./android-tv/selectors";
import type { WebOSSnapshot } from "./lg-webos/selectors";
import type { PhilipsSnapshot } from "./philips-android-tv/selectors";

export type DeviceSnapshot = WebOSSnapshot | AndroidTVDeviceMachineSnapshot | PhilipsSnapshot;

// TODO: split priority logic into a pure function for testability
export const selectConnectionStatus = (snapshot: DeviceSnapshot | undefined): ConnectionStatus => {
  if (!snapshot) return "disconnected";
  if (snapshot.matches("error")) return "error";
  if (snapshot.matches("pairing")) return "pairing";
  if (snapshot.matches({ session: { connection: "connected" } })) return "connected";
  if (snapshot.matches("session")) return "connecting";
  return "disconnected";
};
