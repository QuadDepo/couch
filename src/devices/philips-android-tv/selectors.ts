/**
 * Philips Android TV device machine selectors
 *
 * Flow-level and pairing UI selectors for the Philips pairing flow.
 * Philips uses a PIN-based pairing flow with confirmation step.
 */
import type { SnapshotFrom } from "xstate";
import type { philipsDeviceMachine } from "./machines/device";

export type PhilipsSnapshot = SnapshotFrom<typeof philipsDeviceMachine>;

// ============ Flow state selectors ============

export const isSetup = (snapshot: PhilipsSnapshot): boolean =>
  snapshot.value === "setup";

export const isPairing = (snapshot: PhilipsSnapshot): boolean => {
  const value = snapshot.value;
  return typeof value === "object" && value !== null && "pairing" in value;
};

export const isComplete = (snapshot: PhilipsSnapshot): boolean =>
  snapshot.matches("disconnected") && !!snapshot.context.deviceId;

// ============ Context selectors ============

export const selectDeviceName = (snapshot: PhilipsSnapshot): string =>
  snapshot.context.deviceName;

export const selectDeviceIp = (snapshot: PhilipsSnapshot): string =>
  snapshot.context.deviceIp;

export const selectError = (snapshot: PhilipsSnapshot): string | undefined =>
  snapshot.context.error;

// ============ Pairing substate selectors ============

export const isPairingConnecting = (snapshot: PhilipsSnapshot): boolean =>
  snapshot.matches({ pairing: { active: "connecting" } });

export const isPairingWaitingForPin = (snapshot: PhilipsSnapshot): boolean =>
  snapshot.matches({ pairing: { active: "waitingForPin" } });

export const isPairingConfirming = (snapshot: PhilipsSnapshot): boolean =>
  snapshot.matches({ pairing: { active: "confirming" } });

export const isPairingError = (snapshot: PhilipsSnapshot): boolean =>
  snapshot.matches({ pairing: { active: "error" } });

export const isPairingSuccess = (snapshot: PhilipsSnapshot): boolean =>
  snapshot.matches("disconnected") && !!snapshot.context.deviceId;

// ============ Context selectors ============

export const selectPairingError = (snapshot: PhilipsSnapshot): string | undefined =>
  snapshot.context.error;
