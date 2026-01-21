import { TextAttributes } from "@opentui/core";
import type { WizardContext } from "../../../machines/addDeviceWizardMachine.ts";

interface PairingStepRendererProps {
  context: WizardContext;
}

export function PairingStepRenderer({ context }: PairingStepRendererProps) {
  const { pairingSteps, currentStepIndex, currentInput, error } = context;
  const currentStep = pairingSteps[currentStepIndex];

  if (!currentStep) {
    return <text fg="#FF4444">Error: No pairing step found</text>;
  }

  const stepNumber = currentStepIndex + 1;
  const totalSteps = pairingSteps.length;

  return (
    <box flexDirection="column" gap={1}>
      <text fg="#888888">
        Step {stepNumber} of {totalSteps}
      </text>

      <text fg="#FFFFFF" attributes={TextAttributes.BOLD}>
        {currentStep.title}
      </text>

      <text fg="#AAAAAA">{currentStep.description}</text>

      {currentStep.type === "input" && (
        <box flexDirection="row" marginTop={1}>
          <text fg="#AAAAAA">Enter: </text>
          <text fg="#FFAA00" attributes={TextAttributes.BOLD}>
            {currentStep.inputType === "pin"
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

      {currentStep.type === "waiting" && (
        <text fg="#FFAA00" marginTop={1}>
          Please wait...
        </text>
      )}

      {currentStep.type === "action" && (currentStep.id === "start_pairing" || currentStep.id === "connecting") && (
        <text fg="#FFAA00" marginTop={1}>
          Connecting to TV...
        </text>
      )}

      {error && (
        <text fg="#FF4444" marginTop={1}>
          {error}
        </text>
      )}

      <box marginTop={1}>
        <text fg="#666666">{getStepHint(currentStep.type, currentStep.id)}</text>
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

function getStepHint(stepType: string, stepId?: string): string {
  switch (stepType) {
    case "input":
      return "Enter value and press Enter";
    case "waiting":
      return "Processing...";
    case "action":
      if (stepId === "start_pairing" || stepId === "connecting") {
        return "Establishing connection...";
      }
      return "Complete the action on your TV, then press Enter";
    case "info":
      return "Press Enter to continue";
    default:
      return "Press Enter to continue";
  }
}
