import { TextAttributes } from "@opentui/core";
import { useDialogKeyboard, type PromptContext } from "@opentui-ui/dialog/react";
import type { TVDevice } from "../../types";

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
    <box flexDirection="column" gap={1} paddingLeft={4} paddingRight={4} paddingTop={2} paddingBottom={2}>
      <text fg="#FFAA00" attributes={TextAttributes.BOLD}>Remove Device</text>
      <box marginTop={1} flexDirection="column" gap={1}>
        <text fg="#FFFFFF">Are you sure you want to remove this device?</text>
        <text fg="#AAAAAA">{device.name}</text>
      </box>
      <box marginTop={1} flexDirection="row" gap={2}>
        <text fg="#888888" attributes={TextAttributes.BOLD}>Enter</text>
        <text fg="#666666">to accept, </text>
        <text fg="#888888" attributes={TextAttributes.BOLD}>Esc</text>
        <text fg="#666666">to cancel</text>
      </box>
    </box>
  );
}
