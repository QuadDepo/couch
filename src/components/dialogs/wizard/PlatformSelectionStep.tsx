import { TextAttributes } from "@opentui/core";
import { type WizardContext } from "../../../machines/addDeviceWizardMachine.ts";
import { implementedPlatforms } from "../../../devices/factory.ts";

interface PlatformSelectionStepProps {
  context: WizardContext;
}

export function PlatformSelectionStep({ context }: PlatformSelectionStepProps) {
  const { selectedPlatformIndex } = context;

  return (
    <box flexDirection="column" gap={1}>
      <text fg="#666666">Select your TV platform:</text>

      <box flexDirection="column" marginTop={1}>
        {implementedPlatforms.map((platform, index) => {
          const isSelected = index === selectedPlatformIndex;
          return (
            <box key={platform.id} flexDirection="column" marginBottom={1}>
              <text fg={isSelected ? "#00AAFF" : "#FFFFFF"}>
                {isSelected ? "> " : "  "}
                {platform.name}
              </text>
              <text fg="#666666"> {platform.description}</text>
            </box>
          );
        })}
      </box>

      <box marginTop={1} flexDirection="row">
        <text fg="#888888" attributes={TextAttributes.BOLD}>
          Esc
        </text>
        <text fg="#666666"> to close, </text>
        <text fg="#888888" attributes={TextAttributes.BOLD}>
          ↑↓
        </text>
        <text fg="#666666"> to select, </text>
        <text fg="#888888" attributes={TextAttributes.BOLD}>
          Enter
        </text>
        <text fg="#666666"> to continue</text>
      </box>
    </box>
  );
}
