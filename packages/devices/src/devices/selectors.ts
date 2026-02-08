import type { ConnectionStatus } from "../types";
import type { AndroidTVDeviceMachineSnapshot } from "./android-tv/selectors";
import type { AndroidTvRemoteDeviceMachineSnapshot } from "./android-tv-remote/selectors";
import type { WebOSSnapshot } from "./lg-webos/selectors";
import type { PhilipsSnapshot } from "./philips-tv/selectors";
import type { TizenSnapshot } from "./samsung-tizen/selectors";

export type DeviceSnapshot =
  | WebOSSnapshot
  | AndroidTVDeviceMachineSnapshot
  | AndroidTvRemoteDeviceMachineSnapshot
  | PhilipsSnapshot
  | TizenSnapshot;

// TODO: split priority logic into a pure function for testability
export const selectConnectionStatus = (snapshot: DeviceSnapshot | undefined): ConnectionStatus => {
  if (!snapshot) return "disconnected";
  if (snapshot.matches("error")) return "error";
  if (snapshot.matches("pairing")) return "pairing";
  if (snapshot.matches({ session: { connection: "connected" } })) return "connected";
  if (snapshot.matches("session")) return "connecting";
  return "disconnected";
};
