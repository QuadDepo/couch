import { TextAttributes } from "@opentui/core";
import { ERROR_COLOR, DIM_COLOR } from "./constants.ts";
import type { TVPlatform } from "../../../types/index.ts";

interface UnsupportedMessageProps {
  deviceType: TVPlatform | null;
}

export function UnsupportedMessage({ deviceType }: UnsupportedMessageProps) {
  return (
    <box flexDirection="column" gap={1}>
      <box justifyContent="center">
        <text fg={ERROR_COLOR} attributes={TextAttributes.BOLD}>
          Text input is not supported on this device
        </text>
      </box>
      <box justifyContent="center">
        <text fg={DIM_COLOR}>
          {deviceType === "philips-android-tv"
            ? "Philips Android TV does not support text input via the JointSpace API"
            : "This device does not support text input"}
        </text>
      </box>
    </box>
  );
}
