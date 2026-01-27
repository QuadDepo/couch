import { TextAttributes } from "@opentui/core";
import { WizardHints } from "./WizardHints.tsx";

interface DeviceInfoStepProps {
  name: string;
  ip: string;
  activeField: "name" | "ip";
  error?: string;
}

export function DeviceInfoStep({ name, ip, activeField, error }: DeviceInfoStepProps) {
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
            {name || (activeField === "name" ? "_" : "")}
          </text>
          {activeField === "name" && name && (
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
            {ip || (activeField === "ip" ? "_" : "")}
          </text>
          {activeField === "ip" && ip && (
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

      <WizardHints
        hints={[
          { key: "Tab", label: "to switch field" },
          { key: "Enter", label: "to continue" },
          { key: "Ctrl+Bs", label: "to go back" },
          { key: "Esc", label: "to close" },
        ]}
      />
    </box>
  );
}
