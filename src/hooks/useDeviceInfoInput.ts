import { useState } from "react";

export type DeviceInfoField = "name" | "ip";

export interface DeviceInfoInputState {
  name: string;
  ip: string;
  activeField: DeviceInfoField;
}

export interface DeviceInfoInputHandlers {
  handleChar: (char: string) => void;
  handleBackspace: () => void;
  handleTab: () => void;
  reset: () => void;
}

export interface UseDeviceInfoInputResult extends DeviceInfoInputState, DeviceInfoInputHandlers {
  isValid: boolean;
}

export function useDeviceInfoInput(): UseDeviceInfoInputResult {
  const [name, setName] = useState("");
  const [ip, setIp] = useState("");
  const [activeField, setActiveField] = useState<DeviceInfoField>("name");

  const handleChar = (char: string) => {
    if (activeField === "name") {
      setName((n) => n + char);
    } else {
      setIp((i) => i + char);
    }
  };

  const handleBackspace = () => {
    if (activeField === "name") {
      setName((n) => n.slice(0, -1));
    } else {
      setIp((i) => i.slice(0, -1));
    }
  };

  const handleTab = () => {
    setActiveField((f) => (f === "name" ? "ip" : "name"));
  };

  const reset = () => {
    setName("");
    setIp("");
    setActiveField("name");
  };

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
