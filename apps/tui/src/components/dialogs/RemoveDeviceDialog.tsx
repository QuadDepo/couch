import { TEXT_PRIMARY, TEXT_SECONDARY, type TVDevice, WARNING_COLOR } from "@couch/devices";
import { TextAttributes } from "@opentui/core";
import { type PromptContext, useDialogKeyboard } from "@opentui-ui/dialog/react";
import { HintGroup } from "../shared/HintGroup.tsx";

interface RemoveDeviceDialogProps {
  device: TVDevice;
}

export function RemoveDeviceDialog({
  device,
  resolve,
  dismiss,
  dialogId,
}: RemoveDeviceDialogProps & PromptContext<boolean>) {
  useDialogKeyboard((event) => {
    switch (event.name) {
      case "return":
        resolve(true);
        break;
      case "escape":
        dismiss();
        break;
    }
  }, dialogId);

  return (
    <box
      flexDirection="column"
      gap={1}
      paddingLeft={4}
      paddingRight={4}
      paddingTop={2}
      paddingBottom={2}
    >
      <text fg={WARNING_COLOR} attributes={TextAttributes.BOLD}>
        Remove Device
      </text>
      <box marginTop={1} flexDirection="column" gap={1}>
        <text fg={TEXT_PRIMARY}>Are you sure you want to remove this device?</text>
        <text fg={TEXT_SECONDARY}>{device.name}</text>
      </box>
      <box marginTop={1}>
        <HintGroup
          hints={[
            { key: "Enter", label: "to accept" },
            { key: "Esc", label: "to cancel" },
          ]}
          variant="plain"
        />
      </box>
    </box>
  );
}
