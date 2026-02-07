import { ACTIVE_COLOR, TEXT_SECONDARY } from "@couch/devices";
import { TextAttributes } from "@opentui/core";
import { HintGroup } from "../../shared/HintGroup.tsx";

interface Props {
  deviceName: string;
}

export function CompletionStep({ deviceName }: Props) {
  return (
    <box flexDirection="column" gap={1}>
      <text fg={ACTIVE_COLOR} attributes={TextAttributes.BOLD}>
        Pairing Complete!
      </text>
      <text fg={TEXT_SECONDARY}>
        Successfully paired with {deviceName}. Press Enter to add the device.
      </text>
      <box marginTop={1}>
        <HintGroup
          hints={[
            { key: "Enter", label: "to add device" },
            { key: "Esc", label: "to cancel" },
          ]}
          variant="plain"
        />
      </box>
    </box>
  );
}
