import type { ConnectionStatus } from "../../types";
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

const selectDeviceIp = (snapshot: AndroidTVDeviceMachineSnapshot): string =>
  snapshot.context.deviceIp;

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

const isPairingSuccess = (snapshot: AndroidTVDeviceMachineSnapshot): boolean =>
  snapshot.matches("disconnected") && !!snapshot.context.deviceId;

export const selectPairingError = (snapshot: AndroidTVDeviceMachineSnapshot): string | undefined =>
  snapshot.context.error;

const selectConnectionStatus = (
  snapshot: AndroidTVDeviceMachineSnapshot,
): ConnectionStatus => {
  if (snapshot.matches("error")) return "error";
  if (snapshot.matches("pairing")) return "pairing";
  if (snapshot.matches({ session: { connection: "connected" } })) return "connected";
  if (snapshot.matches("session")) return "connecting";
  return "disconnected";
};
