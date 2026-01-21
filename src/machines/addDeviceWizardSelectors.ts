import type { StateFrom } from "xstate";
import type { addDeviceWizardMachine } from "./addDeviceWizardMachine.ts";

type WizardState = StateFrom<typeof addDeviceWizardMachine>;

type StepState = "platformSelection" | "deviceInfo" | "pairing" | "complete" | "error" | "done" | "cancelled";

const STEP_LABELS: Record<StepState, string> = {
  platformSelection: "Select Platform",
  deviceInfo: "Device Info",
  pairing: "Pairing",
  complete: "Complete",
  error: "Error",
  done: "Done",
  cancelled: "Cancelled",
};

const selectStepState = (state: WizardState): StepState => {
  const value = state.value;
  if (typeof value === "string") return value as StepState;
  return Object.keys(value)[0] as StepState;
};

export const selectStepLabel = (state: WizardState): string => {
  const stepState = selectStepState(state);
  return STEP_LABELS[stepState] ?? "";
};

const selectTotalSteps = (state: WizardState): number => {
  return 2 + state.context.pairingSteps.length + 1;
};

const selectCurrentStepNumber = (state: WizardState): number => {
  const stepState = selectStepState(state);
  const totalSteps = selectTotalSteps(state);
  const currentStepIndex = state.context.currentStepIndex;

  switch (stepState) {
    case "platformSelection":
      return 1;
    case "deviceInfo":
      return 2;
    case "pairing":
    case "error":
      return 3 + currentStepIndex;
    case "complete":
    case "done":
      return totalSteps;
    default:
      return 1;
  }
};

export const selectProgressString = (state: WizardState): string => {
  const current = selectCurrentStepNumber(state);
  const total = selectTotalSteps(state);
  return `${current}/${total}`;
};

export const selectIsExecutingAction = (state: WizardState): boolean =>
  state.matches({ pairing: "executingAction" });

export const selectIsSubmittingInput = (state: WizardState): boolean =>
  state.matches({ pairing: "submittingInput" });

export const selectIsBusy = (state: WizardState): boolean =>
  selectIsExecutingAction(state) || selectIsSubmittingInput(state);

export const selectCurrentPairingStep = (state: WizardState) =>
  state.context.pairingSteps[state.context.currentStepIndex];

export const selectPairingProgress = (state: WizardState): string => {
  const { pairingSteps, currentStepIndex } = state.context;
  if (pairingSteps.length === 0) return "";
  return `Step ${currentStepIndex + 1} of ${pairingSteps.length}`;
};

export const selectCurrentInput = (state: WizardState) => state.context.currentInput;

export const selectError = (state: WizardState) => state.context.error;
