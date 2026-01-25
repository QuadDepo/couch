import { implementedPlatforms } from "../../../devices/factory.ts";
import type { WizardContext } from "../../../machines/addDeviceWizardMachine.ts";
import { WizardHints } from "./WizardHints.tsx";

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

      <WizardHints
        hints={[
          { key: "↑↓", label: "to select" },
          { key: "Enter", label: "to continue" },
          { key: "Esc", label: "to close" },
        ]}
      />
    </box>
  );
}
