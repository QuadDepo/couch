import type { SnapshotFrom } from "xstate";
import { isPairingConnecting } from "../shared/selectors";
import type { tizenDeviceMachine } from "./machines/device";

export type TizenSnapshot = SnapshotFrom<typeof tizenDeviceMachine>;

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

export const isInitiating = (snapshot: TizenSnapshot): boolean =>
  isPairingConnecting(snapshot) && !snapshot.context.promptReceived;
