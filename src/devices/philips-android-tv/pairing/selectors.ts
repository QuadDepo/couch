import type { SnapshotFrom } from "xstate";
import type { philipsPairingMachine } from "./machine";

type Snapshot = SnapshotFrom<typeof philipsPairingMachine>;

export const isStartingPairingState = (state: Snapshot) => state.matches("startingPairing");
export const isEnteringPinState = (state: Snapshot) => state.matches("enteringPin");
export const isConfirmingPairingState = (state: Snapshot) => state.matches("confirmingPairing");
export const isSuccessState = (state: Snapshot) => state.matches("success");
export const isErrorState = (state: Snapshot) => state.matches("error");

export const selectError = (state: Snapshot) => state.context.error;
