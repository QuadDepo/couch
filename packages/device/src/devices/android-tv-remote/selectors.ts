import type { AndroidTvRemoteDeviceMachineSnapshot } from "./machines/device";

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
export type { AndroidTvRemoteDeviceMachineSnapshot };

export const isPairingVerifying = (snapshot: AndroidTvRemoteDeviceMachineSnapshot): boolean =>
  snapshot.matches({ pairing: { active: "verifying" } });

export const selectPairingCode = (snapshot: AndroidTvRemoteDeviceMachineSnapshot): string =>
  snapshot.context.pairingCode;
