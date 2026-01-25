import { TextAttributes } from "@opentui/core";
import { useState, useCallback, useEffect, useImperativeHandle, forwardRef } from "react";

interface DeviceInfoStepProps {
  initialName?: string;
  initialIp?: string;
  error?: string;
  onSubmit: (name: string, ip: string) => void;
}

export interface DeviceInfoStepHandle {
  handleChar: (char: string) => void;
  handleBackspace: () => void;
  handleTab: () => void;
  handleSubmit: () => void;
}

export const DeviceInfoStep = forwardRef<DeviceInfoStepHandle, DeviceInfoStepProps>(
  function DeviceInfoStep({ initialName = "", initialIp = "", error, onSubmit }, ref) {
    const [deviceName, setDeviceName] = useState(initialName);
    const [deviceIp, setDeviceIp] = useState(initialIp);
    const [activeField, setActiveField] = useState<"name" | "ip">("name");

    const handleChar = useCallback((char: string) => {
      if (activeField === "name") {
        setDeviceName((prev) => prev + char);
      } else {
        setDeviceIp((prev) => prev + char);
      }
    }, [activeField]);

    const handleBackspace = useCallback(() => {
      if (activeField === "name") {
        setDeviceName((prev) => prev.slice(0, -1));
      } else {
        setDeviceIp((prev) => prev.slice(0, -1));
      }
    }, [activeField]);

    const handleTab = useCallback(() => {
      setActiveField((prev) => (prev === "name" ? "ip" : "name"));
    }, []);

    const handleSubmit = useCallback(() => {
      onSubmit(deviceName, deviceIp);
    }, [deviceName, deviceIp, onSubmit]);

    useImperativeHandle(ref, () => ({
      handleChar,
      handleBackspace,
      handleTab,
      handleSubmit,
    }), [handleChar, handleBackspace, handleTab, handleSubmit]);

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
          <text fg="#888888" attributes={TextAttributes.BOLD}>
            Esc
          </text>
          <text fg="#666666"> to close, </text>
          <text fg="#888888" attributes={TextAttributes.BOLD}>
            Ctrl+Bksp
          </text>
          <text fg="#666666"> to go back, </text>
          <text fg="#888888" attributes={TextAttributes.BOLD}>
            Tab
          </text>
          <text fg="#666666"> to switch, </text>
          <text fg="#888888" attributes={TextAttributes.BOLD}>
            Enter
          </text>
          <text fg="#666666"> to continue</text>
        </box>
      </box>
    );
  }
);
