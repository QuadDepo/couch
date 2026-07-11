import { useCallback, useState } from "react";
import { ERROR_COLOR, TEXT_SECONDARY } from "../../constants/colors.ts";
import { HintGroup } from "./HintGroup.tsx";
import { TextInput } from "./TextInput.tsx";

type ActiveField = "name" | "ip";

export interface DeviceInfoFieldsState {
  name: string;
  ip: string;
  activeField: ActiveField;
  isValid: boolean;
  handleChar: (char: string) => void;
  handleBackspace: () => void;
  handleTab: () => void;
  reset: () => void;
}

export function useDeviceInfoFields(): DeviceInfoFieldsState {
  const [name, setName] = useState("");
  const [ip, setIp] = useState("");
  const [activeField, setActiveField] = useState<ActiveField>("name");

  const handleChar = useCallback(
    (char: string) => {
      if (activeField === "name") {
        setName((prev) => prev + char);
      } else {
        setIp((prev) => prev + char);
      }
    },
    [activeField],
  );

  const handleBackspace = useCallback(() => {
    if (activeField === "name") {
      setName((prev) => prev.slice(0, -1));
    } else {
      setIp((prev) => prev.slice(0, -1));
    }
  }, [activeField]);

  const handleTab = useCallback(() => {
    setActiveField((prev) => (prev === "name" ? "ip" : "name"));
  }, []);

  const reset = useCallback(() => {
    setName("");
    setIp("");
    setActiveField("name");
  }, []);

  return {
    name,
    ip,
    activeField,
    isValid: name.length > 0 && ip.length > 0,
    handleChar,
    handleBackspace,
    handleTab,
    reset,
  };
}

interface DeviceInfoFieldsProps {
  name: string;
  ip: string;
  activeField: ActiveField;
  error?: string;
}

export function DeviceInfoFields({ name, ip, activeField, error }: DeviceInfoFieldsProps) {
  return (
    <box flexDirection="column" gap={1}>
      <text fg={TEXT_SECONDARY}>Enter device information:</text>

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
