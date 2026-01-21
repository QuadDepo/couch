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

      <box marginTop={1} flexDirection="row">
        <text fg="#888888" attributes={TextAttributes.BOLD}>Esc</text>
        <text fg="#666666"> to close</text>
        {!isBusy && (
          <>
            <text fg="#666666">, </text>
            <text fg="#888888" attributes={TextAttributes.BOLD}>Ctrl+Bksp</text>
            <text fg="#666666"> to go back, </text>
            <text fg="#888888" attributes={TextAttributes.BOLD}>Enter</text>
            <text fg="#666666"> to {getSubmitHint(currentPairingStep.type, actionSuccess)}</text>
          </>
        )}
      </box>
    </box>
  );
}

function formatPinInput(input: string): string {
  return input || "_";
}

function getSubmitHint(stepType: string, actionSuccess?: boolean): string {
  if (actionSuccess) return "continue";
  switch (stepType) {
    case "input":
      return "submit";
    case "action":
      return "confirm";
    default:
      return "continue";
  }
}
