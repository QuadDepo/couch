import { useDeviceHandler } from "../../hooks/useDeviceHandler.ts";
import { useSelectedDevice } from "../../store/deviceStore.ts";
import { getStatusIndicator } from "../../utils/statusIndicator.ts";

interface StatusBarProps {
  isScanning?: boolean;
}

export function StatusBar({ isScanning = false }: StatusBarProps) {
  const device = useSelectedDevice();
  const { status, isImplemented } = useDeviceHandler(device);
  const getStatusIcon = () => {
    if (isScanning) return "...";
    if (!device) return "-";
    return getStatusIndicator(status).icon;
  };

  const getStatusColor = () => {
    if (!device) return "#666666";
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
      borderColor="#444444"
      flexDirection="row"
      alignItems="center"
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={statusColor}> {getStatusIcon()} </text>
      <text fg="#FFFFFF">{getStatusText()}</text>
      {status === "connected" && <text fg="#666666"> ({device?.ip})</text>}
      {device && !isImplemented && <text fg="#FF6600"> [Platform not implemented]</text>}
      <box flexGrow={1} />
      {device && isImplemented && (
        <text fg="#666666">{status === "connected" ? "[C] Disconnect" : "[C] Connect"}</text>
      )}
    </box>
  );
}
