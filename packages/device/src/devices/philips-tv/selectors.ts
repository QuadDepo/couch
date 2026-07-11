import type { SnapshotFrom } from "xstate";
import type { philipsDeviceMachine } from "./machines/device";

export type PhilipsSnapshot = SnapshotFrom<typeof philipsDeviceMachine>;

export {
  isComplete,
  isPairing,
  isPairingConnecting,
  isPairingError,
  isSetup,
  selectDeviceName,
  selectError,
  selectPairingError,
} from "../shared/selectors";

export const isPairingWaitingForPin = (snapshot: PhilipsSnapshot): boolean =>
  snapshot.matches({ pairing: { active: "waitingForPin" } });

export const isPairingConfirming = (snapshot: PhilipsSnapshot): boolean =>
  snapshot.matches({ pairing: { active: "confirming" } });
