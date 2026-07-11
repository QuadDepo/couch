import type { ConnectionStatus } from "../types";
import type { DeviceSnapshot } from "./actors";

export const selectConnectionStatus = (snapshot: DeviceSnapshot | undefined): ConnectionStatus => {
  if (!snapshot) return "disconnected";
  if (snapshot.matches("error")) return "error";
  if (snapshot.matches("pairing")) return "pairing";
  if (snapshot.matches({ session: { connection: "connected" } })) return "connected";
  if (snapshot.matches("session")) return "connecting";
  return "disconnected";
};
