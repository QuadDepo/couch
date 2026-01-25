import type { SnapshotFrom } from "xstate";
import type { androidTvPairingMachine } from "./machine";

type Snapshot = SnapshotFrom<typeof androidTvPairingMachine>;

export const isShowingInfoState = (state: Snapshot) => state.matches("showingInfo");
export const isConnectingState = (state: Snapshot) => state.matches("connecting");
export const isSuccessState = (state: Snapshot) => state.matches("success");
export const isErrorState = (state: Snapshot) => state.matches("error");

export const selectStepIndex = (state: Snapshot) => state.context.stepIndex;
export const selectError = (state: Snapshot) => state.context.error;
