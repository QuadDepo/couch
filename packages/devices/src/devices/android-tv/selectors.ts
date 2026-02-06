import type { AndroidTVDeviceMachineSnapshot } from "./machines/device";

export type { AndroidTVDeviceMachineSnapshot };

export const isSetup = (snapshot: AndroidTVDeviceMachineSnapshot): boolean =>
  snapshot.matches("setup");

export const isPairing = (snapshot: AndroidTVDeviceMachineSnapshot): boolean =>
  snapshot.matches("pairing");

export const isComplete = (snapshot: AndroidTVDeviceMachineSnapshot): boolean =>
  snapshot.matches("disconnected") && !!snapshot.context.deviceId;

export const selectDeviceName = (snapshot: AndroidTVDeviceMachineSnapshot): string =>
  snapshot.context.deviceName;

export const selectError = (snapshot: AndroidTVDeviceMachineSnapshot): string | undefined =>
  snapshot.context.error;

export const isPairingInstructions = (snapshot: AndroidTVDeviceMachineSnapshot): boolean =>
  snapshot.matches({ pairing: "instructions" });

export const isPairingConnecting = (snapshot: AndroidTVDeviceMachineSnapshot): boolean =>
  snapshot.matches({ pairing: { active: "connecting" } });

export const isPairingWaitingForUser = (snapshot: AndroidTVDeviceMachineSnapshot): boolean =>
  snapshot.matches({ pairing: { active: "waitingForUser" } });

export const isPairingError = (snapshot: AndroidTVDeviceMachineSnapshot): boolean =>
  snapshot.matches({ pairing: { active: "error" } });

export const selectInstructionStep = (snapshot: AndroidTVDeviceMachineSnapshot): number =>
  snapshot.context.instructionStep;

export const selectPairingError = (snapshot: AndroidTVDeviceMachineSnapshot): string | undefined =>
  snapshot.context.error;
