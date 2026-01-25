import type { SnapshotFrom, StateFrom } from "xstate";
import {
  PAIRING_ACTOR_ID,
  type addDeviceWizardMachine,
  type PairingActorRef,
} from "./addDeviceWizardMachine.ts";

type WizardState = StateFrom<typeof addDeviceWizardMachine>;
type WizardSnapshot = SnapshotFrom<typeof addDeviceWizardMachine>;

type StepState =
  | "platformSelection"
  | "deviceInfo"
  | "connection"
  | "complete"
  | "error"
  | "done"
  | "cancelled";

const STEP_LABELS: Record<StepState, string> = {
  platformSelection: "Select Platform",
  deviceInfo: "Device Info",
  connection: "Pairing",
  complete: "Complete",
  error: "Error",
  done: "Done",
  cancelled: "Cancelled",
};

export const selectStepState = (state: WizardState): StepState => {
  const value = state.value;
  if (typeof value === "string") return value as StepState;
  return Object.keys(value)[0] as StepState;
};

export const selectStepLabel = (state: WizardState): string => {
  const stepState = selectStepState(state);
  return STEP_LABELS[stepState] ?? "";
};

export const selectPlatform = (state: WizardState) => state.context.platform;

export const selectError = (state: WizardState) => state.context.error;

export const selectPairingActorRef = (snapshot: WizardSnapshot): PairingActorRef | undefined => {
  return snapshot.children[PAIRING_ACTOR_ID] as PairingActorRef | undefined;
};

export const selectProgressString = (state: WizardState): string => {
  const stepState = selectStepState(state);
  if (stepState === "platformSelection") return "";

  const stepNumbers: Record<StepState, number> = {
    platformSelection: 0,
    deviceInfo: 1,
    connection: 2,
    complete: 3,
    error: 2,
    done: 3,
    cancelled: 0,
  };

  const current = stepNumbers[stepState] ?? 0;
  const total = 3;
  return `${current}/${total}`;
};
