import { TextAttributes } from "@opentui/core";
import { DIM_COLOR } from "../../../constants/colors.ts";

interface Props {
  deviceName: string;
}

export function CompletionStep({ deviceName }: Props) {
  return (
    <box flexDirection="column" gap={1}>
      <text fg="#00FF00" attributes={TextAttributes.BOLD}>
        Pairing Complete!
      </text>
      <text fg={DIM_COLOR}>
        Successfully paired with {deviceName}. Press Enter to add the device.
      </text>
    </box>
  );
}
