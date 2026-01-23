import type { SnapshotFrom } from "xstate";
import type { PairingUIState } from "../../types.ts";
import type { webOSWizardMachine } from "./machine.ts";

type WebOSWizardState = SnapshotFrom<typeof webOSWizardMachine>;

export function selectUIState(snapshot: WebOSWizardState): PairingUIState | null {
  const { value, context } = snapshot;

  if (value === "deviceInfo") {
    return null;
  }

  // Skip UI for connecting state - it's fast enough that showing it just causes flicker
  if (value === "connecting") {
    return null;
  }

  if (value === "awaitingConfirmation") {
    return {
      title: "Confirm on TV",
      description:
        context.error ||
        "A pairing request has been sent to your TV. Please accept the request on your TV screen, then press Enter.",
      variant: "action",
    };
  }

  if (value === "checkingStatus") {
    return {
      title: "Checking",
      description: "Checking pairing status...",
      variant: "loading",
    };
  }

  if (value === "error") {
    return {
      title: "Connection Failed",
      description: context.error ?? "Failed to connect to WebOS TV",
      variant: "error",
      canRetry: true,
    };
  }

  if (value === "complete") {
    return {
      title: "Complete",
      description: "Successfully paired with your WebOS TV!",
      variant: "info",
    };
  }

  return null;
}
