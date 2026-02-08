import type { SnapshotFrom } from "xstate";
import type { philipsDeviceMachine } from "./machines/device";

export type PhilipsSnapshot = SnapshotFrom<typeof philipsDeviceMachine>;

export const isSetup = (snapshot: PhilipsSnapshot): boolean => snapshot.matches("setup");

export const isPairing = (snapshot: PhilipsSnapshot): boolean => snapshot.matches("pairing");

export const isComplete = (snapshot: PhilipsSnapshot): boolean =>
  snapshot.matches("disconnected") && !!snapshot.context.deviceId;

export const selectDeviceName = (snapshot: PhilipsSnapshot): string => snapshot.context.deviceName;

export const selectError = (snapshot: PhilipsSnapshot): string | undefined =>
  snapshot.context.error;

export const isPairingConnecting = (snapshot: PhilipsSnapshot): boolean =>
  snapshot.matches({ pairing: { active: "connecting" } });

export const isPairingWaitingForPin = (snapshot: PhilipsSnapshot): boolean =>
  snapshot.matches({ pairing: { active: "waitingForPin" } });

export const isPairingConfirming = (snapshot: PhilipsSnapshot): boolean =>
  snapshot.matches({ pairing: { active: "confirming" } });

export const isPairingError = (snapshot: PhilipsSnapshot): boolean =>
  snapshot.matches({ pairing: { active: "error" } });

export const selectPairingError = (snapshot: PhilipsSnapshot): string | undefined =>
  snapshot.context.error;
