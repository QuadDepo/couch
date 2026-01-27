import { DIM_COLOR, TEXT_DIM, TEXT_PRIMARY, WARNING_COLOR } from "../../constants/colors.ts";
import { useDevice } from "../../hooks/useDevice.ts";
import { getStatusIndicator } from "../../utils/statusIndicator.ts";
import { KeyHint } from "../shared/KeyHint.tsx";

interface StatusBarProps {
  isScanning?: boolean;
}

export function StatusBar({ isScanning = false }: StatusBarProps) {
  const { device, status, isImplemented } = useDevice();
  const getStatusIcon = () => {
    if (isScanning) return "...";
    if (!device) return "-";
    return getStatusIndicator(status).icon;
  };

  const getStatusColor = () => {
    if (!device) return TEXT_DIM;
    return getStatusIndicator(status).color;
  };

  const getStatusText = () => {
    if (isScanning) return "Scanning for devices...";
    if (!device) return "No device selected";
    switch (status) {
      case "connected":
        return `Connected to ${device.name}`;
      case "connecting":
        return `Connecting to ${device.name}...`;
      case "pairing":
        return `Pairing with ${device.name}...`;
      case "error":
        return `Error connecting to ${device.name}`;
      default:
        return `Disconnected from ${device.name}`;
    }
  };

  const statusColor = getStatusColor();

  return (
    <box
      width="100%"
      height={3}
      borderStyle="single"
      borderColor={DIM_COLOR}
      flexDirection="row"
      alignItems="center"
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={statusColor}> {getStatusIcon()} </text>
      <text fg={TEXT_PRIMARY}>{getStatusText()}</text>
      {status === "connected" && <text fg={TEXT_DIM}> ({device?.ip})</text>}
      {device && !isImplemented && <text fg={WARNING_COLOR}> [Platform not implemented]</text>}
      <box flexGrow={1} />
      {device && isImplemented && (
        <KeyHint keyName="C" label={status === "connected" ? "Disconnect" : "Connect"} />
      )}
    </box>
  );
}
