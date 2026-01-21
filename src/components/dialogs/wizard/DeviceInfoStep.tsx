import { TextAttributes } from "@opentui/core";
import type { WizardContext } from "../../../machines/addDeviceWizardMachine.ts";

interface DeviceInfoStepProps {
  context: WizardContext;
}

export function DeviceInfoStep({ context }: DeviceInfoStepProps) {
  const { deviceName, deviceIp, activeField, error } = context;

  return (
    <box flexDirection="column" gap={1}>
      <text fg="#666666">Enter device information:</text>

      <box flexDirection="column" marginTop={1} gap={1}>
        <box flexDirection="row">
          <text fg="#AAAAAA" width={6}>
            Name:{" "}
          </text>
          <text
            fg={activeField === "name" ? "#00AAFF" : "#FFFFFF"}
            attributes={activeField === "name" ? TextAttributes.UNDERLINE : 0}
          >
            {deviceName || (activeField === "name" ? "_" : "")}
          </text>
          {activeField === "name" && deviceName && (
            <text fg="#00AAFF" attributes={TextAttributes.BOLD}>
              _
            </text>
          )}
        </box>

        <box flexDirection="row">
          <text fg="#AAAAAA" width={6}>
            IP:{" "}
          </text>
          <text
            fg={activeField === "ip" ? "#00AAFF" : "#FFFFFF"}
            attributes={activeField === "ip" ? TextAttributes.UNDERLINE : 0}
          >
            {deviceIp || (activeField === "ip" ? "_" : "")}
          </text>
          {activeField === "ip" && deviceIp && (
            <text fg="#00AAFF" attributes={TextAttributes.BOLD}>
              _
            </text>
          )}
        </box>
      </box>

      {error && (
        <text fg="#FF4444" marginTop={1}>
          {error}
        </text>
      )}

      <box marginTop={1} flexDirection="row">
        <text fg="#888888" attributes={TextAttributes.BOLD}>Tab</text>
        <text fg="#666666"> to switch fields, </text>
        <text fg="#888888" attributes={TextAttributes.BOLD}>Enter</text>
        <text fg="#666666"> to continue, </text>
        <text fg="#888888" attributes={TextAttributes.BOLD}>Esc</text>
        <text fg="#666666"> to go back</text>
      </box>
    </box>
  );
}
