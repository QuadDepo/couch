import type { SnapshotFrom } from "xstate";
import type { tizenDeviceMachine } from "./machines/device";

export type TizenSnapshot = SnapshotFrom<typeof tizenDeviceMachine>;

export const isSetup = (snapshot: TizenSnapshot): boolean => snapshot.matches("setup");

export const isPairing = (snapshot: TizenSnapshot): boolean => snapshot.matches("pairing");

export const isComplete = (snapshot: TizenSnapshot): boolean =>
  snapshot.matches("disconnected") && !!snapshot.context.deviceId;

export const selectDeviceName = (snapshot: TizenSnapshot): string => snapshot.context.deviceName;

export const selectError = (snapshot: TizenSnapshot): string | undefined => snapshot.context.error;

export const isPairingConnecting = (snapshot: TizenSnapshot): boolean =>
  snapshot.matches({ pairing: { active: "connecting" } });

export const isPairingWaitingForUser = (snapshot: TizenSnapshot): boolean =>
  snapshot.matches({ pairing: { active: "waitingForUser" } });

export const isPairingError = (snapshot: TizenSnapshot): boolean =>
  snapshot.matches({ pairing: { active: "error" } });

export const isInitiating = (snapshot: TizenSnapshot): boolean =>
  isPairingConnecting(snapshot) && !snapshot.context.promptReceived;

export const selectPairingError = (snapshot: TizenSnapshot): string | undefined =>
  snapshot.context.error;
