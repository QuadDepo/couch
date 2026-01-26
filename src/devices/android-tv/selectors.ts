import type { AndroidTVDeviceMachineSnapshot } from "./machines/device";

export type { AndroidTVDeviceMachineSnapshot };

export const isSetup = (snapshot: AndroidTVDeviceMachineSnapshot): boolean =>
  snapshot.value === "setup";

export const isPairing = (snapshot: AndroidTVDeviceMachineSnapshot): boolean => {
  const value = snapshot.value;
  return typeof value === "object" && value !== null && "pairing" in value;
};

export const isComplete = (snapshot: AndroidTVDeviceMachineSnapshot): boolean =>
  snapshot.matches("disconnected") && !!snapshot.context.deviceId;

export const selectDeviceName = (snapshot: AndroidTVDeviceMachineSnapshot): string =>
  snapshot.context.deviceName;

export const selectDeviceIp = (snapshot: AndroidTVDeviceMachineSnapshot): string =>
  snapshot.context.deviceIp;

export const selectError = (snapshot: AndroidTVDeviceMachineSnapshot): string | undefined =>
  snapshot.context.error;

export const isPairingConnecting = (snapshot: AndroidTVDeviceMachineSnapshot): boolean =>
  snapshot.matches({ pairing: { active: "connecting" } });

export const isPairingWaitingForUser = (snapshot: AndroidTVDeviceMachineSnapshot): boolean =>
  snapshot.matches({ pairing: { active: "waitingForUser" } });

export const isPairingError = (snapshot: AndroidTVDeviceMachineSnapshot): boolean =>
  snapshot.matches({ pairing: { active: "error" } });

export const isPairingSuccess = (snapshot: AndroidTVDeviceMachineSnapshot): boolean =>
  snapshot.matches("disconnected") && !!snapshot.context.deviceId;

export const selectPairingError = (snapshot: AndroidTVDeviceMachineSnapshot): string | undefined =>
  snapshot.context.error;
