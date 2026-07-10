import type { AndroidTvRemoteDeviceMachineSnapshot } from "./machines/device";

export type { AndroidTvRemoteDeviceMachineSnapshot };

export const isSetup = (snapshot: AndroidTvRemoteDeviceMachineSnapshot): boolean =>
  snapshot.matches("setup");

export const isPairing = (snapshot: AndroidTvRemoteDeviceMachineSnapshot): boolean =>
  snapshot.matches("pairing");

export const isComplete = (snapshot: AndroidTvRemoteDeviceMachineSnapshot): boolean =>
  snapshot.matches("disconnected") && !!snapshot.context.deviceId;

export const selectDeviceName = (snapshot: AndroidTvRemoteDeviceMachineSnapshot): string =>
  snapshot.context.deviceName;

export const selectError = (snapshot: AndroidTvRemoteDeviceMachineSnapshot): string | undefined =>
  snapshot.context.error;

export const isPairingConnecting = (snapshot: AndroidTvRemoteDeviceMachineSnapshot): boolean =>
  snapshot.matches({ pairing: { active: "connecting" } });

export const isPairingWaitingForUser = (snapshot: AndroidTvRemoteDeviceMachineSnapshot): boolean =>
  snapshot.matches({ pairing: { active: "waitingForUser" } });

export const isPairingVerifying = (snapshot: AndroidTvRemoteDeviceMachineSnapshot): boolean =>
  snapshot.matches({ pairing: { active: "verifying" } });

export const isPairingError = (snapshot: AndroidTvRemoteDeviceMachineSnapshot): boolean =>
  snapshot.matches({ pairing: { active: "error" } });

export const selectPairingError = (
  snapshot: AndroidTvRemoteDeviceMachineSnapshot,
): string | undefined => snapshot.context.error;

export const selectPairingCode = (snapshot: AndroidTvRemoteDeviceMachineSnapshot): string =>
  snapshot.context.pairingCode;
