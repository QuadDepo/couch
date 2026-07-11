import type { SnapshotFrom } from "xstate";
import { isPairingConnecting } from "../shared/selectors";
import type { webosDeviceMachine } from "./machines/device";

export type WebOSSnapshot = SnapshotFrom<typeof webosDeviceMachine>;

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

// Connecting but prompt not yet shown on TV
export const isInitiating = (snapshot: WebOSSnapshot): boolean =>
  isPairingConnecting(snapshot) && !snapshot.context.promptReceived;
