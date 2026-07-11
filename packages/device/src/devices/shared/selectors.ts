import type { DeviceStateTestValue } from "../actors";

/**
 * Structural snapshot shape the shared selectors rely on. Every factory-built
 * device machine satisfies this, so vendor selector modules re-export these and
 * add only their platform-specific substates.
 */
export interface DeviceSelectorSnapshot {
  context: {
    deviceId: string | null;
    deviceName: string;
    error?: string;
    promptReceived: boolean;
  };
  matches(value: DeviceStateTestValue): boolean;
}

export const isSetup = (snapshot: DeviceSelectorSnapshot): boolean => snapshot.matches("setup");

export const isPairing = (snapshot: DeviceSelectorSnapshot): boolean => snapshot.matches("pairing");

export const isComplete = (snapshot: DeviceSelectorSnapshot): boolean =>
  snapshot.matches("disconnected") && !!snapshot.context.deviceId;

export const selectDeviceName = (snapshot: DeviceSelectorSnapshot): string =>
  snapshot.context.deviceName;

export const selectError = (snapshot: DeviceSelectorSnapshot): string | undefined =>
  snapshot.context.error;

export const isPairingConnecting = (snapshot: DeviceSelectorSnapshot): boolean =>
  snapshot.matches({ pairing: { active: "connecting" } });

export const isPairingWaitingForUser = (snapshot: DeviceSelectorSnapshot): boolean =>
  snapshot.matches({ pairing: { active: "waitingForUser" } });

export const isPairingError = (snapshot: DeviceSelectorSnapshot): boolean =>
  snapshot.matches({ pairing: { active: "error" } });

export const selectPairingError = (snapshot: DeviceSelectorSnapshot): string | undefined =>
  snapshot.context.error;
