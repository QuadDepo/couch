import { forwardRef, useImperativeHandle, useState } from "react";
import { ERROR_COLOR, TEXT_SECONDARY } from "../../constants/colors.ts";
import { HintGroup } from "./HintGroup.tsx";
import { TextInput } from "./TextInput.tsx";

type ActiveField = "name" | "ip";

export interface DeviceInfoFieldsRef {
  name: string;
  ip: string;
  isValid: boolean;
  handleChar: (char: string) => void;
  handleBackspace: () => void;
  handleTab: () => void;
  reset: () => void;
}

interface DeviceInfoFieldsProps {
  error?: string;
}

export const DeviceInfoFields = forwardRef<DeviceInfoFieldsRef, DeviceInfoFieldsProps>(
  function DeviceInfoFields({ error }, ref) {
    const [name, setName] = useState("");
    const [ip, setIp] = useState("");
    const [activeField, setActiveField] = useState<ActiveField>("name");

    useImperativeHandle(
      ref,
      () => ({
        name,
        ip,
        isValid: name.length > 0 && ip.length > 0,
        handleChar: (char: string) => {
          if (activeField === "name") {
            setName((n) => n + char);
          } else {
            setIp((i) => i + char);
          }
        },
        handleBackspace: () => {
          if (activeField === "name") {
            setName((n) => n.slice(0, -1));
          } else {
            setIp((i) => i.slice(0, -1));
          }
        },
        handleTab: () => {
          setActiveField((f) => (f === "name" ? "ip" : "name"));
        },
        reset: () => {
          setName("");
          setIp("");
          setActiveField("name");
        },
      }),
      [name, ip, activeField],
    );

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
  },
);
