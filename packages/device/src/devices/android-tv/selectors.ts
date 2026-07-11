import type { AndroidTVDeviceMachineSnapshot } from "./machines/device";

export {
  isComplete,
  isPairing,
  isPairingConnecting,
  isPairingError,
  isPairingWaitingForUser,
  isSetup,
  selectDeviceName,
  selectError,
  selectPairingError,
} from "../shared/selectors";
export type { AndroidTVDeviceMachineSnapshot };

export const isPairingInstructions = (snapshot: AndroidTVDeviceMachineSnapshot): boolean =>
  snapshot.matches({ pairing: "instructions" });

export const selectInstructionStep = (snapshot: AndroidTVDeviceMachineSnapshot): number =>
  snapshot.context.instructionStep;
