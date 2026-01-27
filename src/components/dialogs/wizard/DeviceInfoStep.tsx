import { ERROR_COLOR, TEXT_DIM } from "../../../constants/colors.ts";
import { HintGroup } from "../../shared/HintGroup.tsx";
import { TextInput } from "../../shared/TextInput.tsx";

interface DeviceInfoStepProps {
  name: string;
  ip: string;
  activeField: "name" | "ip";
  error?: string;
}

export function DeviceInfoStep({ name, ip, activeField, error }: DeviceInfoStepProps) {
  return (
    <box flexDirection="column" gap={1}>
      <text fg={TEXT_DIM}>Enter device information:</text>

      <box flexDirection="column" marginTop={1} gap={1}>
        <TextInput value={name} focused={activeField === "name"} label="Name: " />
        <TextInput value={ip} focused={activeField === "ip"} label="IP: " />
      </box>

      {error && (
        <text fg={ERROR_COLOR} marginTop={1}>
          {error}
        </text>
      )}

      <box marginTop={1}>
        <HintGroup
          hints={[
            { key: "Tab", label: "to switch field" },
            { key: "Enter", label: "to continue" },
            { key: "Ctrl+Bs", label: "to go back" },
            { key: "Esc", label: "to close" },
          ]}
          variant="plain"
        />
      </box>
    </box>
  );
}
