import type { SnapshotFrom } from "xstate";
import type { webosDeviceMachine } from "./machines/device";

export type WebOSSnapshot = SnapshotFrom<typeof webosDeviceMachine>;

export const isSetup = (snapshot: WebOSSnapshot): boolean =>
  snapshot.value === "setup";

export const isPairing = (snapshot: WebOSSnapshot): boolean => {
  const value = snapshot.value;
  return typeof value === "object" && value !== null && "pairing" in value;
};

export const isComplete = (snapshot: WebOSSnapshot): boolean =>
  snapshot.value === "disconnected" && !!snapshot.context.deviceId;

export const selectDeviceName = (snapshot: WebOSSnapshot): string =>
  snapshot.context.deviceName;

export const selectDeviceIp = (snapshot: WebOSSnapshot): string =>
  snapshot.context.deviceIp;

export const selectError = (snapshot: WebOSSnapshot): string | undefined =>
  snapshot.context.error;

export const isPairingConnecting = (snapshot: WebOSSnapshot): boolean =>
  snapshot.matches({ pairing: { active: "connecting" } });

export const isPairingWaitingForUser = (snapshot: WebOSSnapshot): boolean =>
  snapshot.matches({ pairing: { active: "waitingForUser" } });

export const isPairingError = (snapshot: WebOSSnapshot): boolean =>
  snapshot.matches({ pairing: { active: "error" } });

export const isPairingSuccess = (snapshot: WebOSSnapshot): boolean =>
  snapshot.matches("disconnected") && !!snapshot.context.deviceId;

// Connecting but prompt not yet shown on TV
export const isInitiating = (snapshot: WebOSSnapshot): boolean =>
  isPairingConnecting(snapshot) && !snapshot.context.promptReceived;

export const selectPairingError = (snapshot: WebOSSnapshot): string | undefined =>
  snapshot.context.error;
