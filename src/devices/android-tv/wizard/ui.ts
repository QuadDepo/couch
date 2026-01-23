import type { SnapshotFrom } from "xstate";
import type { PairingUIState } from "../../types.ts";
import { androidTVInstructions, type androidTVWizardMachine } from "./machine.ts";

type AndroidTVWizardState = SnapshotFrom<typeof androidTVWizardMachine>;

export function selectUIState(snapshot: AndroidTVWizardState): PairingUIState | null {
  const { value, context } = snapshot;

  if (value === "deviceInfo") {
    return null;
  }

  if (value === "showingInstructions") {
    const instruction = androidTVInstructions[context.instructionStep];
    return {
      title: instruction?.title ?? "Setup Instructions",
      description: instruction?.description ?? "",
      variant: "info",
    };
  }

  if (value === "connecting") {
    return {
      title: "Connecting",
      description: "Attempting to connect to your Android TV via ADB...",
      variant: "loading",
    };
  }

  if (value === "error") {
    return {
      title: "Connection Failed",
      description: context.error ?? "Failed to connect to Android TV",
      variant: "error",
      canRetry: true,
    };
  }

  if (value === "complete") {
    return {
      title: "Complete",
      description: "Successfully connected to your Android TV!",
      variant: "info",
    };
  }

  return null;
}
