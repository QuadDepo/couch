import { TextAttributes } from "@opentui/core";
import { DIM_COLOR, ERROR_COLOR } from "../../constants/colors.ts";
import { useDevice } from "../../hooks/useDevice.ts";

export function UnsupportedMessage() {
  const { device } = useDevice();
  const deviceType = device?.platform ?? null;

  return (
    <box flexDirection="column" gap={1}>
      <box justifyContent="center">
        <text fg={ERROR_COLOR} attributes={TextAttributes.BOLD}>
          Text input is not supported on this device
        </text>
      </box>
      <box justifyContent="center">
        <text fg={DIM_COLOR}>
          {deviceType === "philips-tv"
            ? "Philips TV does not support text input via the JointSpace API"
            : "This device does not support text input"}
        </text>
      </box>
    </box>
  );
}
