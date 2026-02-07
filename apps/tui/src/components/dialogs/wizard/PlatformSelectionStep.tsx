import { FOCUS_COLOR, implementedPlatforms, TEXT_DIM, TEXT_PRIMARY } from "@couch/devices";
import { HintGroup } from "../../shared/HintGroup.tsx";

interface PlatformSelectionStepProps {
  selectedPlatformIndex: number;
}

export function PlatformSelectionStep({ selectedPlatformIndex }: PlatformSelectionStepProps) {
  return (
    <box flexDirection="column" gap={1}>
      <text fg={TEXT_DIM}>Select your TV platform:</text>

      <box flexDirection="column" marginTop={1}>
        {implementedPlatforms.map((platform, index) => {
          const isSelected = index === selectedPlatformIndex;
          return (
            <box key={platform.id} flexDirection="column" marginBottom={1}>
              <text fg={isSelected ? FOCUS_COLOR : TEXT_PRIMARY}>
                {isSelected ? "> " : "  "}
                {platform.name}
              </text>
              <text fg={TEXT_DIM}> {platform.description}</text>
            </box>
          );
        })}
      </box>

      <HintGroup
        hints={[
          { key: "↑↓", label: "to select" },
          { key: "Enter", label: "to continue" },
          { key: "Esc", label: "to close" },
        ]}
        variant="plain"
      />
    </box>
  );
}
