import type { SnapshotFrom, StateFrom } from "xstate";
import {
  type addDeviceWizardMachine,
  PAIRING_ACTOR_ID,
  type PairingActorRef,
} from "./addDeviceWizardMachine.ts";

type WizardState = StateFrom<typeof addDeviceWizardMachine>;
type WizardSnapshot = SnapshotFrom<typeof addDeviceWizardMachine>;

export const isPlatformSelectionState = (state: WizardState) => state.matches("platformSelection");
export const isDeviceInfoState = (state: WizardState) => state.matches("deviceInfo");
export const isConnectionState = (state: WizardState) => state.matches("connection");
export const isCompleteState = (state: WizardState) => state.matches("complete");
export const isErrorState = (state: WizardState) => state.matches("error");
export const isDoneState = (state: WizardState) => state.matches("done");
export const isCancelledState = (state: WizardState) => state.matches("cancelled");

// Context selectors
export const selectPlatform = (state: WizardState) => state.context.platform;
export const selectError = (state: WizardState) => state.context.error;

export const selectPairingActorRef = (snapshot: WizardSnapshot): PairingActorRef | undefined => {
  return snapshot.children[PAIRING_ACTOR_ID] as PairingActorRef | undefined;
};


// TODO: see if we can improve these step label / progress selectors with a more generic approach
export const selectStepLabel = (state: WizardState): string => {
  if (isPlatformSelectionState(state)) return "Select Platform";
  if (isDeviceInfoState(state)) return "Device Info";
  if (isConnectionState(state)) return "Pairing";
  if (isCompleteState(state)) return "Complete";
  if (isErrorState(state)) return "Error";
  if (isDoneState(state)) return "Done";
  if (isCancelledState(state)) return "Cancelled";
  return "";
};

export const selectProgressString = (state: WizardState): string => {
  if (isPlatformSelectionState(state)) return "";
  if (isCancelledState(state)) return "";

  const total = 3;
  let current = 0;

  if (isDeviceInfoState(state)) current = 1;
  else if (isConnectionState(state)) current = 2;
  else if (isErrorState(state)) current = 2;
  else if (isCompleteState(state)) current = 3;
  else if (isDoneState(state)) current = 3;

  return `${current}/${total}`;
};
