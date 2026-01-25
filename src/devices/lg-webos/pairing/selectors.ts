import type { SnapshotFrom } from "xstate";
import type { webosPairingMachine } from "./machine";

type Snapshot = SnapshotFrom<typeof webosPairingMachine>;

export const isInitiatingState = (state: Snapshot) => state.matches({ connecting: "initiating" });
export const isWaitingState = (state: Snapshot) => state.matches({ connecting: "waiting" });
export const isConnectingState = (state: Snapshot) => state.matches("connecting");
export const isSuccessState = (state: Snapshot) => state.matches("success");
export const isErrorState = (state: Snapshot) => state.matches("error");

export const selectError = (state: Snapshot) => state.context.error;
