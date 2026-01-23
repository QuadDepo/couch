import type { SnapshotFrom } from "xstate";
import type { PairingUIState } from "../../types.ts";
import type { philipsWizardMachine } from "./machine.ts";

type PhilipsWizardState = SnapshotFrom<typeof philipsWizardMachine>;

export function selectUIState(snapshot: PhilipsWizardState): PairingUIState | null {
  const { value, context } = snapshot;

  if (value === "deviceInfo") {
    return null;
  }

  if (value === "requestingPin") {
    return {
      title: "Requesting PIN",
      description: "Please wait, a PIN code will appear on your TV...",
      variant: "loading",
    };
  }

  if (value === "enteringPin") {
    return {
      title: "Enter PIN",
      description: "Enter the 4-digit PIN shown on your TV",
      variant: "input",
      input: { type: "pin", value: context.pin, maxLength: 4 },
    };
  }

  if (value === "validatingPin") {
    return {
      title: "Validating",
      description: "Checking PIN...",
      variant: "loading",
    };
  }

  if (value === "pinError") {
    return {
      title: "Invalid PIN",
      description: context.error ?? "The PIN was incorrect. Please try again.",
      variant: "input",
      input: { type: "pin", value: context.pin, maxLength: 4 },
    };
  }

  if (value === "error") {
    return {
      title: "Error",
      description: context.error ?? "An error occurred",
      variant: "error",
      canRetry: true,
    };
  }

  if (value === "complete") {
    return {
      title: "Complete",
      description: "Pairing successful!",
      variant: "info",
    };
  }

  return null;
}
