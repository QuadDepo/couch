import { TextAttributes } from "@opentui/core";
import { useWizard } from "./WizardProvider.tsx";

export function PairingStepRenderer() {
  const {
    currentPairingStep,
    isExecutingAction,
    isSubmittingInput,
    isBusy,
    currentInput,
    error,
    actionSuccess,
  } = useWizard();

  if (!currentPairingStep) {
    return <text fg="#FF4444">Error: No pairing step found</text>;
  }

  return (
    <box flexDirection="column" gap={1}>
      <text fg="#FFFFFF" attributes={TextAttributes.BOLD}>
        {currentPairingStep.title}
      </text>

      <text fg="#AAAAAA">{currentPairingStep.description}</text>

      {isExecutingAction && (
        <text fg="#FFAA00" marginTop={1}>
          Connecting to TV...
        </text>
      )}

      {isSubmittingInput && (
        <text fg="#FFAA00" marginTop={1}>
          Submitting...
        </text>
      )}

      {actionSuccess && (
        <text fg="#00FF00" marginTop={1}>
          Connected successfully!
        </text>
      )}

      {!isBusy && !actionSuccess && currentPairingStep.type === "input" && (
        <box flexDirection="row" marginTop={1}>
          <text fg="#AAAAAA">Enter: </text>
          <text fg="#FFAA00" attributes={TextAttributes.BOLD}>
            {currentPairingStep.inputType === "pin"
              ? formatPinInput(currentInput)
              : currentInput || "_"}
          </text>
          {currentInput && (
            <text fg="#FFAA00" attributes={TextAttributes.BOLD}>
              _
            </text>
          )}
        </box>
      )}

      {!isBusy && !actionSuccess && currentPairingStep.type === "waiting" && (
        <text fg="#FFAA00" marginTop={1}>
          Please wait...
        </text>
      )}

      {error && (
        <text fg="#FF4444" marginTop={1}>
          {error}
        </text>
      )}

      <box marginTop={1}>
        <text fg="#666666">{getStepHint(currentPairingStep.type, isExecutingAction, isSubmittingInput, actionSuccess)}</text>
      </box>
    </box>
  );
}

function formatPinInput(input: string): string {
  const maxLength = 6;
  const display = input.padEnd(maxLength, "_");
  return display
    .split("")
    .map((char, i) => (i < input.length ? char : "_"))
    .join("");
}

function getStepHint(stepType: string, isExecuting: boolean, isSubmitting: boolean, actionSuccess?: boolean): string {
  if (isExecuting) {
    return "Establishing connection...";
  }
  if (isSubmitting) {
    return "Sending to device...";
  }
  if (actionSuccess) {
    return "Press Enter to continue";
  }
  switch (stepType) {
    case "input":
      return "Enter value and press Enter";
    case "waiting":
      return "Processing...";
    case "action":
      return "Complete the action on your TV, then press Enter";
    case "info":
      return "Press Enter to continue";
    default:
      return "Press Enter to continue";
  }
}
